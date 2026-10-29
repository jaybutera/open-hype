/**
 * Validation and normalisation of AI-pushed overlay sets.
 *
 * Pure: no DOM, no Vite. The Vite AI plugin runs this server-side against the
 * latest chart snapshot; messages are written for the AI that sent the push,
 * so they say what was wrong and what to send instead.
 */
import { etToUtcMs, formatEt } from '../../utils/chartTime.ts';
import {
  COLOR_NAMES, MAX_SETS_PER_PUSH, MAX_SHAPES_PER_SET, SET_PALETTE, SHAPE_TYPES,
  type ChartSnapshot, type OverlaySet, type OverlayShape, type SnapshotCandle, type SnapshotPane,
} from './types.ts';

export class OverlayValidationError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'OverlayValidationError';
    this.details = details;
  }
}

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000,
  '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_592_000_000,
};

export function intervalMs(interval: string | undefined, candles: SnapshotCandle[] = []): number {
  if (interval && INTERVAL_MS[interval]) return INTERVAL_MS[interval];
  if (candles.length >= 2) return candles[candles.length - 1].t - candles[candles.length - 2].t;
  return 60_000;
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Hex or palette name -> hex. Throws a message on anything else. */
export function resolveColor(value: unknown): string {
  if (typeof value === 'string') {
    const v = value.trim();
    if (HEX_RE.test(v)) return v.toLowerCase();
    const named = COLOR_NAMES[v.toLowerCase() as keyof typeof COLOR_NAMES];
    if (named) return named;
  }
  throw new Error(
    `invalid color ${JSON.stringify(value)}; use #rgb, #rrggbb or one of ${Object.keys(COLOR_NAMES).join(', ')}`,
  );
}

/**
 * Parse a time input to UTC ms. Accepts a number (ms; < 1e12 is read as
 * seconds), an ISO-8601 string, or "YYYY-MM-DD HH:MM ET" (the snapshot's `et`
 * format). Zone-less ISO strings are read as UTC.
 */
export function parseTime(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`time ${value} is not a positive number`);
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d+(\.\d+)?$/.test(s)) return parseTime(Number(s));
    const et = s.match(/^(.*?)\s*(?:ET|EST|EDT|America\/New_York)$/i);
    if (et) {
      const ms = etToUtcMs(et[1]);
      if (ms !== null) return ms;
    } else {
      const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
      const iso = hasZone ? s : `${s.replace(' ', 'T')}Z`;
      const ms = Date.parse(iso);
      if (Number.isFinite(ms) && /^\d{4}-\d{2}-\d{2}/.test(s)) return ms;
    }
  }
  throw new Error(
    `cannot read time ${JSON.stringify(value)}; use UTC ms (a candle's "t"), an ISO-8601 string with zone, or "YYYY-MM-DD HH:MM ET"`,
  );
}

interface Ctx {
  snapshot: ChartSnapshot | null;
  candles: SnapshotCandle[];
  barMs: number;
  /** Interval of the pane whose candles are checked. */
  interval: string;
  warnings: string[];
  errors: string[];
  /** No pane shows the set's asset. */
  noPane?: boolean;
}

/**
 * The pane whose candles belong to `asset`: the active pane when it shows it,
 * else another mounted pane on that asset, else null.
 */
export function pickPane(snapshot: ChartSnapshot, asset: string): SnapshotPane | null {
  if (snapshot.asset === asset) {
    return { pane: snapshot.pane, asset, interval: snapshot.interval, candles: snapshot.candles };
  }
  return snapshot.panes?.find(p => p.asset === asset) ?? null;
}

interface Snapped { t: number; bar: SnapshotCandle | null; now: boolean }

/** Index of the last candle with t <= ms, or -1. */
function floorIndex(candles: SnapshotCandle[], ms: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Snap a time to a bar open: the bar that contains it, else the nearest bar.
 * Times outside the snapshot's candles snap to the interval grid.
 */
function snapTime(raw: unknown, path: string, ctx: Ctx, allowNow: boolean): Snapped {
  const { candles, barMs } = ctx;
  if (raw === 'now') {
    if (!allowNow) throw new Error(`"now" is only allowed for box.t2, line.t2 and hline.to`);
    if (candles.length === 0) {
      return { t: ctx.snapshot?.takenAt ?? Date.now(), bar: null, now: true };
    }
    const last = candles[candles.length - 1];
    return { t: last.t, bar: last, now: true };
  }
  const ms = parseTime(raw);
  if (candles.length === 0) {
    ctx.warnings.push(`${path}: no candles in the chart view to snap to; time kept as given (${formatEt(ms)})`);
    return { t: ms, bar: null, now: false };
  }
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (ms < first.t - barMs / 2 || ms >= last.t + barMs) {
    const grid = Math.floor(ms / barMs) * barMs;
    ctx.warnings.push(
      `${path}: ${formatEt(ms)} is outside the visible candles (${first.et} .. ${last.et}); ` +
      `snapped to the ${ctx.interval} grid at ${formatEt(grid)}, bar prices not checked`,
    );
    return { t: grid, bar: null, now: false };
  }
  const i = floorIndex(candles, ms);
  let bar: SnapshotCandle;
  if (i >= 0 && ms < candles[i].t + barMs) {
    bar = candles[i];
  } else {
    // In a gap between bars (or just before the first): take the nearest open.
    const before = i >= 0 ? candles[i] : null;
    const after = candles[i + 1] ?? null;
    bar = !before ? after! : !after ? before : (ms - before.t <= after.t - ms ? before : after);
    if (Math.abs(bar.t - ms) > barMs / 2) {
      ctx.warnings.push(`${path}: ${formatEt(ms)} has no bar; moved to the nearest bar at ${bar.et}`);
    }
  }
  return { t: bar.t, bar, now: false };
}

function price(raw: unknown, path: string): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${path} must be a finite number > 0, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function optText(raw: unknown, path: string, required = false): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new Error(`${path} is required`);
    return undefined;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error(`${path} must be a string`);
  return String(raw).trim().slice(0, 120);
}

function checkBarPrice(p: number, s: Snapped, path: string, ctx: Ctx) {
  const bar = s.bar;
  if (!bar) return;
  if (p < bar.l * 0.995 || p > bar.h * 1.005) {
    ctx.warnings.push(
      `${path}: price ${p} is outside the ${bar.et} bar (high ${bar.h}, low ${bar.l}); ` +
      `kept as given, re-push if you meant that bar`,
    );
  }
}

function normalizeShape(raw: unknown, path: string, setColor: string, ctx: Ctx): OverlayShape {
  if (!raw || typeof raw !== 'object') throw new Error(`${path} must be an object`);
  const s = raw as Record<string, unknown>;
  const type = s.type;
  if (typeof type !== 'string' || !(SHAPE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`${path}.type ${JSON.stringify(type)} is unknown; allowed types: ${SHAPE_TYPES.join(', ')}`);
  }
  const color = s.color === undefined || s.color === null || s.color === ''
    ? setColor
    : (() => { try { return resolveColor(s.color); } catch (e) { throw new Error(`${path}.color: ${(e as Error).message}`); } })();
  const text = optText(s.text, `${path}.text`, type === 'label');
  const t = (key: string, allowNow = false) => {
    if (s[key] === undefined || s[key] === null) throw new Error(`${path}.${key} is required`);
    try { return snapTime(s[key], `${path}.${key}`, ctx, allowNow); }
    catch (e) { throw new Error(`${path}.${key}: ${(e as Error).message}`); }
  };

  switch (type) {
    case 'hline': {
      const style = s.style ?? 'solid';
      if (style !== 'solid' && style !== 'dashed') throw new Error(`${path}.style must be "solid" or "dashed"`);
      const out: OverlayShape = { type, price: price(s.price, `${path}.price`), color, style };
      if (text) out.text = text;
      if (s.from !== undefined && s.from !== null) out.from = t('from').t;
      if (s.to !== undefined && s.to !== null) {
        const to = t('to', true);
        out.to = to.t;
        if (to.now) out.toNow = true;
      }
      if (out.from !== undefined && out.to !== undefined && out.from > out.to) {
        [out.from, out.to] = [out.to, out.from];
      }
      return out;
    }
    case 'box': {
      const a = t('t1');
      const b = t('t2', true);
      const p1 = price(s.p1, `${path}.p1`);
      const p2 = price(s.p2, `${path}.p2`);
      const out: OverlayShape = {
        type, t1: Math.min(a.t, b.t), t2: Math.max(a.t, b.t),
        p1: Math.max(p1, p2), p2: Math.min(p1, p2), color,
      };
      if (b.now) out.t2Now = true;
      if (text) out.text = text;
      return out;
    }
    case 'line': {
      const a = t('t1');
      const b = t('t2', true);
      if (s.extend !== undefined && s.extend !== null && s.extend !== 'right') {
        throw new Error(`${path}.extend must be "right" or omitted`);
      }
      const out: OverlayShape = {
        type, t1: a.t, p1: price(s.p1, `${path}.p1`), t2: b.t, p2: price(s.p2, `${path}.p2`), color,
      };
      if (b.now) out.t2Now = true;
      if (s.extend === 'right') out.extend = 'right';
      if (text) out.text = text;
      return out;
    }
    case 'arrow': {
      const at = t('time');
      const p = price(s.price, `${path}.price`);
      if (s.dir !== 'up' && s.dir !== 'down') {
        throw new Error(`${path}.dir must be "up" (arrow below the price pointing up) or "down" (above, pointing down)`);
      }
      checkBarPrice(p, at, `${path}.price`, ctx);
      const out: OverlayShape = { type, time: at.t, price: p, dir: s.dir, color };
      if (text) out.text = text;
      return out;
    }
    case 'label': {
      const at = t('time');
      const p = price(s.price, `${path}.price`);
      checkBarPrice(p, at, `${path}.price`, ctx);
      return { type, time: at.t, price: p, text: text!, color };
    }
    default: {
      const at = t('time');
      const out: OverlayShape = { type: 'vline', time: at.t, color };
      if (text) out.text = text;
      return out;
    }
  }
}

export interface NormalizeOptions {
  id?: string;
  batch?: string;
  /** Position used to pick a default colour from the palette. */
  index?: number;
  now?: number;
}

function makeId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const rnd = c?.randomUUID ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

/**
 * Validate one overlay set against the latest chart snapshot.
 * Returns the normalised set plus warnings, or throws OverlayValidationError
 * listing every problem found in the set.
 */
export function normalizeOverlaySet(
  input: unknown,
  snapshot: ChartSnapshot | null,
  opts: NormalizeOptions = {},
): { set: OverlaySet; warnings: string[] } {
  const candles = snapshot?.candles ?? [];
  const ctx: Ctx = {
    snapshot, candles, barMs: intervalMs(snapshot?.interval, candles),
    interval: snapshot?.interval ?? '', warnings: [], errors: [],
  };

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new OverlayValidationError('each set must be an object { name, shapes, description?, asset?, color? }');
  }
  const s = input as Record<string, unknown>;
  const errors: string[] = [];

  const name = typeof s.name === 'string' ? s.name.trim() : '';
  if (!name) errors.push('name is required (a short button label, under ~24 chars)');
  else if (name.length > 40) errors.push(`name is ${name.length} chars; max 40`);
  const label = name || '(unnamed)';

  let description: string | undefined;
  if (s.description !== undefined && s.description !== null && s.description !== '') {
    if (typeof s.description !== 'string') errors.push('description must be a string');
    else if (s.description.trim().length > 200) errors.push(`description is ${s.description.trim().length} chars; max 200`);
    else description = s.description.trim();
  }

  let asset = snapshot?.asset ?? '';
  if (s.asset !== undefined && s.asset !== null && s.asset !== '') {
    if (typeof s.asset !== 'string') errors.push('asset must be a string');
    else asset = s.asset.trim();
  }
  if (!asset) errors.push('asset is required: no chart snapshot to default it from');
  else if (snapshot) {
    // Check against the pane that shows the set's asset: the active pane first, then any other
    // mounted pane. If none shows it, skip the bar checks rather than use another asset's bars.
    const pane = pickPane(snapshot, asset);
    if (pane) {
      ctx.candles = pane.candles;
      ctx.interval = pane.interval;
      ctx.barMs = intervalMs(pane.interval, pane.candles);
    } else {
      ctx.candles = [];
      ctx.noPane = true;
      ctx.warnings.push(`asset ${asset} differs from the chart's ${snapshot.asset}; the set only draws when the user views ${asset}, and times/prices were not checked against its candles`);
    }
  }

  let color = SET_PALETTE[(opts.index ?? 0) % SET_PALETTE.length];
  if (s.color !== undefined && s.color !== null && s.color !== '') {
    try { color = resolveColor(s.color); } catch (e) { errors.push(`color: ${(e as Error).message}`); }
  }

  const shapes: OverlayShape[] = [];
  if (!Array.isArray(s.shapes) || s.shapes.length === 0) {
    errors.push('shapes must be a non-empty array');
  } else if (s.shapes.length > MAX_SHAPES_PER_SET) {
    errors.push(`${s.shapes.length} shapes; max ${MAX_SHAPES_PER_SET} per set, split into more sets`);
  } else {
    s.shapes.forEach((raw, i) => {
      try { shapes.push(normalizeShape(raw, `shapes[${i}]`, color, ctx)); }
      catch (e) { errors.push((e as Error).message); }
    });
  }
  if (ctx.noPane) {
    // The "no candles to snap to" notes are noise once the asset warning is given.
    ctx.warnings = ctx.warnings.filter(w => !w.includes('no candles in the chart view'));
  }

  if (errors.length > 0) {
    throw new OverlayValidationError(
      `set "${label}" is invalid: ${errors.join('; ')}`,
      errors.map(e => `[${label}] ${e}`),
    );
  }

  return {
    set: {
      id: opts.id ?? makeId('ai'),
      batch: opts.batch ?? makeId('batch'),
      name,
      ...(description ? { description } : {}),
      asset,
      color,
      createdAt: opts.now ?? Date.now(),
      shapes,
    },
    warnings: ctx.warnings.map(w => `[${label}] ${w}`),
  };
}

/**
 * Validate a whole push body `{ sets, replace? }`. All sets share one batch id.
 * `existingCount` offsets the default colour so new sets do not repeat the
 * colours already on screen.
 */
export function normalizePush(
  body: unknown,
  snapshot: ChartSnapshot | null,
  opts: { existingCount?: number; now?: number } = {},
): { sets: OverlaySet[]; warnings: string[]; replace: boolean } {
  if (!body || typeof body !== 'object') {
    throw new OverlayValidationError('body must be JSON { sets: OverlaySetInput[], replace?: boolean }');
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.sets) || b.sets.length === 0) {
    throw new OverlayValidationError('sets must be a non-empty array of overlay sets');
  }
  if (b.sets.length > MAX_SETS_PER_PUSH) {
    throw new OverlayValidationError(`${b.sets.length} sets; max ${MAX_SETS_PER_PUSH} per push`);
  }
  const replace = b.replace === true;
  const batch = makeId('batch');
  const now = opts.now ?? Date.now();
  const base = replace ? 0 : (opts.existingCount ?? 0);
  const sets: OverlaySet[] = [];
  const warnings: string[] = [];
  const details: string[] = [];
  b.sets.forEach((raw, i) => {
    try {
      const r = normalizeOverlaySet(raw, snapshot, { batch, index: base + i, now });
      sets.push(r.set);
      warnings.push(...r.warnings);
    } catch (e) {
      if (e instanceof OverlayValidationError) details.push(...(e.details.length ? e.details : [e.message]));
      else details.push(String((e as Error).message ?? e));
    }
  });
  if (details.length > 0) {
    throw new OverlayValidationError(
      `${details.length} problem(s); nothing was stored, fix and push again`,
      details,
    );
  }
  return { sets, warnings, replace };
}

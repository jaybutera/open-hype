/**
 * Strategy signals: trade setups pushed by an outside process (a strategy
 * runner such as scripts/strategy-signals.py) to POST /api/signals.
 *
 * Pure: no DOM, no Vite. vite-signals-plugin.ts holds one SignalBook and
 * relays its list to the page, which shows each signal as a card in the right
 * column and draws it on the chart when the card is clicked.
 */
import { normalizeOverlaySet, OverlayValidationError, parseTime } from '../ai/validate.ts';
import type { OverlayShape } from '../ai/types.ts';

export type SignalStatus = 'resting' | 'filled' | 'won' | 'lost' | 'cancelled';
export const SIGNAL_STATUSES: readonly SignalStatus[] = ['resting', 'filled', 'won', 'lost', 'cancelled'];

export interface StrategySignal {
  /** `${source}:${key}` */
  id: string;
  /** The process that pushed it, e.g. "v3". */
  source: string;
  /** The pusher's own id for the setup; the same key in a later push updates the signal. */
  key: string;
  /** Label on the card. Defaults to `source`. */
  strategy: string;
  asset: string;
  side: 'long' | 'short';
  /** Timeframe the setup formed on, e.g. "15m". */
  tf?: string;
  /** When the setup completed, UTC ms. */
  time: number;
  entry: number;
  stop: number;
  target: number;
  status: SignalStatus;
  /** Why it has that status, e.g. "gap inverted". */
  statusNote?: string;
  /** When the plan ended (cancelled, or the trade closed), UTC ms. The setup box stops here. */
  endTime?: number;
  note?: string;
  /** Context drawn with the setup: the sweep, the structure break, the entry gap. */
  shapes: OverlayShape[];
  /** When the server first saw this id. */
  receivedAt: number;
  updatedAt: number;
}

/** A pusher and its last push: the page shows it so a quiet strategy can be told from a dead one. */
export interface SignalSource {
  source: string;
  /** When the server last received a push from it, UTC ms. */
  lastPushAt: number;
  /** Seconds between the bar close the push was computed for and the push, when the pusher says. */
  lagSec?: number;
  /** What it runs on, e.g. "SP500 XYZ100 CL SILVER, 5m 15m 1h 4h". */
  watching?: string;
}

export class SignalValidationError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'SignalValidationError';
    this.details = details;
  }
}

export const MAX_SIGNALS_PER_PUSH = 100;
/** Signals whose `time` is older than this are dropped. */
export const SIGNAL_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const SHAPE_COLOR = '#f0b90b';

function num(raw: unknown, path: string, errors: string[]): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    errors.push(`${path} must be a finite number > 0, got ${JSON.stringify(raw)}`);
    return NaN;
  }
  return n;
}

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const s = String(raw).trim();
  return s ? s.slice(0, max) : undefined;
}

type Normalized = Omit<StrategySignal, 'receivedAt' | 'updatedAt'>;

/** Validate one pushed signal. Throws SignalValidationError listing every problem. */
export function normalizeSignal(input: unknown, source: string): Normalized {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SignalValidationError('each signal must be an object { key, asset, entry, stop, target, time, ... }');
  }
  const s = input as Record<string, unknown>;
  const errors: string[] = [];

  const key = str(s.key, 120);
  if (!key) errors.push('key is required: a stable id for the setup, so a later push updates it');
  const asset = str(s.asset, 40);
  if (!asset) errors.push('asset is required, e.g. "xyz:SP500"');

  const entry = num(s.entry, 'entry', errors);
  const stop = num(s.stop, 'stop', errors);
  const target = num(s.target, 'target', errors);
  let side: 'long' | 'short' = stop < entry ? 'long' : 'short';
  if (s.side !== undefined && s.side !== null && s.side !== '') {
    if (s.side !== 'long' && s.side !== 'short') errors.push('side must be "long" or "short"');
    else side = s.side;
  }
  if (Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(target)) {
    const ok = side === 'long' ? stop < entry && entry < target : target < entry && entry < stop;
    if (!ok) errors.push(`a ${side} needs ${side === 'long' ? 'stop < entry < target' : 'target < entry < stop'}; got entry ${entry}, stop ${stop}, target ${target}`);
  }

  let time = NaN;
  try { time = parseTime(s.time); } catch (e) { errors.push(`time: ${(e as Error).message}`); }
  let endTime: number | undefined;
  if (s.endTime !== undefined && s.endTime !== null && s.endTime !== '') {
    try { endTime = parseTime(s.endTime); } catch (e) { errors.push(`endTime: ${(e as Error).message}`); }
  }

  let status: SignalStatus = 'resting';
  if (s.status !== undefined && s.status !== null && s.status !== '') {
    if (!SIGNAL_STATUSES.includes(s.status as SignalStatus)) errors.push(`status must be one of ${SIGNAL_STATUSES.join(', ')}`);
    else status = s.status as SignalStatus;
  }

  let shapes: OverlayShape[] = [];
  if (s.shapes !== undefined && s.shapes !== null) {
    if (!Array.isArray(s.shapes)) errors.push('shapes must be an array of overlay shapes (hline, box, line, arrow, label, vline)');
    else if (s.shapes.length > 0) {
      try {
        // No snapshot: times are kept as given, the chart places them between bars.
        shapes = normalizeOverlaySet({ name: 'signal', asset: asset ?? 'x', color: SHAPE_COLOR, shapes: s.shapes }, null).set.shapes;
      } catch (e) {
        if (e instanceof OverlayValidationError) errors.push(...e.details.map(d => d.replace('[signal] ', '')));
        else errors.push(String((e as Error).message ?? e));
      }
    }
  }

  if (errors.length > 0) {
    const label = key ?? '(no key)';
    throw new SignalValidationError(`signal "${label}" is invalid: ${errors.join('; ')}`, errors.map(e => `[${label}] ${e}`));
  }

  const tf = str(s.tf, 8);
  const statusNote = str(s.statusNote, 120);
  const note = str(s.note, 300);
  return {
    id: `${source}:${key}`,
    source,
    key: key!,
    strategy: str(s.strategy, 24) ?? source,
    asset: asset!,
    side,
    ...(tf ? { tf } : {}),
    time,
    entry, stop, target,
    status,
    ...(statusNote ? { statusNote } : {}),
    ...(endTime !== undefined ? { endTime } : {}),
    ...(note ? { note } : {}),
    shapes,
  };
}

export interface PushResult {
  ok: true;
  /** Ids the server had not seen before. */
  added: string[];
  /** Ids whose content changed. */
  updated: string[];
  /** Ids no longer in the source's list (replace pushes only). */
  removed: string[];
  count: number;
}

/** The server's signal list, newest first. */
export class SignalBook {
  private signals = new Map<string, StrategySignal>();
  /** Ids the user removed; a pusher that keeps sending them does not bring them back. */
  private dismissed = new Set<string>();
  private sources = new Map<string, SignalSource>();

  listSources(): SignalSource[] {
    return [...this.sources.values()].sort((a, b) => a.source.localeCompare(b.source));
  }

  list(): StrategySignal[] {
    return [...this.signals.values()].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
  }

  /**
   * Body `{ source, signals, replace?, lagSec?, watching? }`. With `replace`, `signals` is the
   * source's whole current list and its other signals are dropped. Nothing is
   * stored when any signal is invalid.
   */
  push(body: unknown, now = Date.now()): PushResult {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new SignalValidationError('body must be JSON { source: string, signals: Signal[], replace?: boolean }');
    }
    const b = body as Record<string, unknown>;
    const source = str(b.source, 40);
    if (!source || !/^[\w.-]+$/.test(source)) {
      throw new SignalValidationError('source is required: a short name for the pusher (letters, digits, _ . -), e.g. "v3"');
    }
    if (!Array.isArray(b.signals)) throw new SignalValidationError('signals must be an array (empty with replace: true clears the source)');
    if (b.signals.length > MAX_SIGNALS_PER_PUSH) {
      throw new SignalValidationError(`${b.signals.length} signals; max ${MAX_SIGNALS_PER_PUSH} per push`);
    }
    const replace = b.replace === true;

    const incoming: Normalized[] = [];
    const details: string[] = [];
    for (const raw of b.signals) {
      try { incoming.push(normalizeSignal(raw, source)); } catch (e) {
        if (e instanceof SignalValidationError) details.push(...(e.details.length ? e.details : [e.message]));
        else details.push(String((e as Error).message ?? e));
      }
    }
    if (details.length > 0) {
      throw new SignalValidationError(`${details.length} problem(s); nothing was stored, fix and push again`, details);
    }

    const lag = typeof b.lagSec === 'number' && Number.isFinite(b.lagSec) && b.lagSec >= 0 ? Math.round(b.lagSec * 10) / 10 : undefined;
    const watching = str(b.watching, 120);
    this.sources.set(source, { source, lastPushAt: now, ...(lag !== undefined ? { lagSec: lag } : {}), ...(watching ? { watching } : {}) });

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const sent = new Set(incoming.map(s => s.id));
    for (const s of incoming) {
      if (this.dismissed.has(s.id) || now - s.time > SIGNAL_MAX_AGE_MS) continue;
      const prev = this.signals.get(s.id);
      if (!prev) {
        this.signals.set(s.id, { ...s, receivedAt: now, updatedAt: now });
        added.push(s.id);
        continue;
      }
      const { receivedAt, updatedAt: _u, ...old } = prev;
      if (JSON.stringify(old) === JSON.stringify(s)) continue;
      this.signals.set(s.id, { ...s, receivedAt, updatedAt: now });
      updated.push(s.id);
    }
    if (replace) {
      for (const [id, s] of this.signals) {
        if (s.source === source && !sent.has(id)) { this.signals.delete(id); removed.push(id); }
      }
      // The source stopped sending it, so the dismissal has nothing left to hide.
      for (const id of this.dismissed) {
        if (id.startsWith(`${source}:`) && !sent.has(id)) this.dismissed.delete(id);
      }
    }
    for (const [id, s] of this.signals) {
      if (now - s.time > SIGNAL_MAX_AGE_MS) { this.signals.delete(id); removed.push(id); }
    }
    return { ok: true, added, updated, removed, count: this.signals.size };
  }

  /** Remove one signal and keep it out. False when the id is unknown. */
  dismiss(id: string): boolean {
    if (!this.signals.delete(id)) return false;
    this.dismissed.add(id);
    return true;
  }

  /** Remove every signal; the ones removed stay out while their source keeps sending them. */
  clear(): number {
    const n = this.signals.size;
    for (const id of this.signals.keys()) this.dismissed.add(id);
    this.signals.clear();
    return n;
  }
}

/** Reward over risk, 0 when the stop sits on the entry. */
export function signalRr(s: Pick<StrategySignal, 'entry' | 'stop' | 'target'>): number {
  const risk = Math.abs(s.entry - s.stop);
  return risk > 0 ? Math.abs(s.target - s.entry) / risk : 0;
}

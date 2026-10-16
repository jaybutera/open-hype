/**
 * One-minute history of GEXBot's headline levels. GEXBot's classic feed has
 * only the present, so the dev server records a sample a minute (see
 * vite-gex-plugin.ts) and serves it at /api/gex/:ticker/:dte/history.
 * Pure: shared by the plugin, the page and the tests.
 */
import { etToUtcMs, formatEt, utcToChartTime } from '../../utils/chartTime.ts';

export interface GexSample {
  /** UTC ms of the GEXBot reading (its `timestamp`). */
  t: number;
  spot: number;
  zeroGamma: number;
  majorPosVol: number;
  majorNegVol: number;
  majorPosOi: number;
  majorNegOi: number;
  sumGexVol: number;
  sumGexOi: number;
}

export type GexLevelKey = 'zeroGamma' | 'majorPosVol' | 'majorNegVol' | 'majorPosOi' | 'majorNegOi';
export const GEX_LEVEL_KEYS: readonly GexLevelKey[] = ['zeroGamma', 'majorPosVol', 'majorNegVol', 'majorPosOi', 'majorNegOi'];

export interface GexLookbackRow {
  minutes: number;
  /** UTC ms of the sample used: the last one at or before (latest reading - minutes). */
  asOf: number;
  zeroGamma: number;
  majorPosVol: number;
  majorNegVol: number;
  majorPosOi: number;
  majorNegOi: number;
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return v != null && Number.isFinite(n) ? n : null;
};

/** A sample from a raw GEXBot classic response, or null when a headline field is missing. */
export function sampleFromRaw(raw: unknown): GexSample | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ts = finite(r.timestamp);
  const spot = finite(r.spot);
  const zeroGamma = finite(r.zero_gamma);
  const majorPosVol = finite(r.major_pos_vol);
  const majorNegVol = finite(r.major_neg_vol);
  const majorPosOi = finite(r.major_pos_oi);
  const majorNegOi = finite(r.major_neg_oi);
  if (ts === null || spot === null || zeroGamma === null || majorPosVol === null || majorNegVol === null
    || majorPosOi === null || majorNegOi === null) return null;
  return {
    t: Math.round(ts * 1000),
    spot, zeroGamma, majorPosVol, majorNegVol, majorPosOi, majorNegOi,
    sumGexVol: finite(r.sum_gex_vol) ?? 0,
    sumGexOi: finite(r.sum_gex_oi) ?? 0,
  };
}

/** A sample parsed back from a JSONL line, or null. */
export function sampleFromJson(v: unknown): GexSample | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of ['t', 'spot', ...GEX_LEVEL_KEYS, 'sumGexVol', 'sumGexOi']) {
    const n = finite(o[k]);
    if (n === null) return null;
    out[k] = n;
  }
  return out as unknown as GexSample;
}

/** UTC ms of 00:00 ET on the ET calendar day holding utcMs. */
export function etDayStart(utcMs: number): number {
  return etToUtcMs(`${formatEt(utcMs).slice(0, 10)} 00:00`) ?? utcMs;
}

/** True Mon..Fri 09:30 to 16:00 ET (exchange holidays not excluded). */
export function isRth(utcMs: number): boolean {
  const shifted = new Date(utcToChartTime(Math.floor(utcMs / 1000)) * 1000);
  const day = shifted.getUTCDay();
  if (day === 0 || day === 6) return false;
  const min = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return min >= 9 * 60 + 30 && min < 16 * 60;
}

/** UTC ms of 00:00 ET on the weekday `days - 1` weekdays before the one holding utcMs. */
export function tradingDaysStart(utcMs: number, days: number): number {
  let start = etDayStart(utcMs);
  let counted = 0;
  // Count today only when it is a weekday, then step back day by day.
  const isWeekday = (ms: number) => {
    const d = new Date(utcToChartTime(Math.floor(ms / 1000)) * 1000).getUTCDay();
    return d !== 0 && d !== 6;
  };
  if (isWeekday(start + 12 * 3600_000)) counted = 1;
  while (counted < days) {
    start = etDayStart(start - 12 * 3600_000);
    if (isWeekday(start + 12 * 3600_000)) counted++;
  }
  return start;
}

/** Index of the last sample with t <= at, or -1. Samples ascending by t. */
export function indexAtOrBefore(samples: readonly GexSample[], at: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= at) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Levels `minutes` before the latest sample (or before `anchor` when given),
 * from the last sample at or before that time. A lookback with no sample
 * that old is left out.
 */
export function lookbackRows(samples: readonly GexSample[], minutes: readonly number[], anchor?: number): GexLookbackRow[] {
  if (samples.length === 0) return [];
  const ref = anchor ?? samples[samples.length - 1].t;
  const rows: GexLookbackRow[] = [];
  for (const m of minutes) {
    const i = indexAtOrBefore(samples, ref - m * 60_000);
    if (i < 0) continue;
    const s = samples[i];
    rows.push({
      minutes: m, asOf: s.t,
      zeroGamma: s.zeroGamma, majorPosVol: s.majorPosVol, majorNegVol: s.majorNegVol,
      majorPosOi: s.majorPosOi, majorNegOi: s.majorNegOi,
    });
  }
  return rows;
}

/** In-memory samples per "TICKER/dte", ascending by t, deduped on t. */
export class GexSampleStore {
  private _byKey = new Map<string, GexSample[]>();

  constructor(private readonly days = 5) {}

  keys(): string[] { return [...this._byKey.keys()]; }

  /** Adds a sample unless one with the same t exists. Returns true when stored. */
  add(key: string, s: GexSample): boolean {
    let list = this._byKey.get(key);
    if (!list) { list = []; this._byKey.set(key, list); }
    const last = list[list.length - 1];
    if (!last || s.t > last.t) { list.push(s); return true; }
    const i = indexAtOrBefore(list, s.t);
    if (i >= 0 && list[i].t === s.t) return false;
    list.splice(i + 1, 0, s);
    return true;
  }

  /** Drops samples older than the start of the last `days` trading days before `now`. */
  trim(now: number): void {
    const cutoff = tradingDaysStart(now, this.days);
    for (const [key, list] of this._byKey) {
      const i = list.findIndex(s => s.t >= cutoff);
      if (i < 0) this._byKey.delete(key);
      else if (i > 0) list.splice(0, i);
    }
  }

  /** Samples with from <= t <= to, ascending. */
  range(key: string, from: number, to: number): GexSample[] {
    const list = this._byKey.get(key);
    if (!list) return [];
    const out: GexSample[] = [];
    for (let i = Math.max(0, indexAtOrBefore(list, from - 1) + 1); i < list.length && list[i].t <= to; i++) out.push(list[i]);
    return out;
  }

  latest(key: string): GexSample | undefined {
    const list = this._byKey.get(key);
    return list?.[list.length - 1];
  }
}

import type { CandleData, CandleInterval } from '../../types/market.ts';

export function intervalToMs(interval: CandleInterval): number {
  const map: Record<string, number> = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000,
    '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_592_000_000,
  };
  return map[interval] ?? 300_000;
}

/** UTC-aligned open time of the interval bucket containing tMs. */
export function bucketStart(tMs: number, intervalMs: number): number {
  return Math.floor(tMs / intervalMs) * intervalMs;
}

/** Merge one 1m candle into an interval candle in place. */
function merge(agg: CandleData, c: CandleData): void {
  if (parseFloat(c.h) > parseFloat(agg.h)) agg.h = c.h;
  if (parseFloat(c.l) < parseFloat(agg.l)) agg.l = c.l;
  agg.c = c.c;
  agg.v = String(parseFloat(agg.v) + parseFloat(c.v));
  agg.n += c.n;
}

function newBucket(c: CandleData, bucket: number, intervalMs: number, interval: CandleInterval): CandleData {
  return {
    t: bucket,
    T: bucket + intervalMs - 1,
    s: c.s,
    i: interval,
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
    v: c.v,
    n: c.n,
  };
}

/**
 * Aggregate sorted 1m candles into interval candles on UTC-aligned buckets.
 * The final candle is partial if the input doesn't cover its full bucket.
 */
export function aggregate1m(oneMin: CandleData[], interval: CandleInterval): CandleData[] {
  if (interval === '1m') return oneMin.map(c => ({ ...c }));
  const intervalMs = intervalToMs(interval);
  const out: CandleData[] = [];
  let cur: CandleData | null = null;
  for (const c of oneMin) {
    const bucket = bucketStart(c.t, intervalMs);
    if (cur && cur.t === bucket) {
      merge(cur, c);
    } else {
      cur = newBucket(c, bucket, intervalMs, interval);
      out.push(cur);
    }
  }
  return out;
}

/**
 * Merge one 1m candle into the tail of an existing aggregated series,
 * returning the updated-or-new interval candle (for appendCandle).
 */
export function mergeIntoInterval(
  last: CandleData | undefined,
  c: CandleData,
  interval: CandleInterval,
): CandleData {
  if (interval === '1m') return { ...c };
  const intervalMs = intervalToMs(interval);
  const bucket = bucketStart(c.t, intervalMs);
  if (last && last.t === bucket) {
    const agg = { ...last };
    merge(agg, c);
    return agg;
  }
  return newBucket(c, bucket, intervalMs, interval);
}

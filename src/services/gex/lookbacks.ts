/**
 * How far back the GEX level trail marks, per candle interval. One table for
 * the chart trail, the strike-bar outline, the AI snapshot and the MCP (which
 * reaches it through the dev server's history endpoint).
 */
export const GEX_LOOKBACKS: Record<string, readonly [number, number]> = {
  '1m': [15, 30],
  '5m': [30, 60],
  '15m': [60, 120],
  '1h': [120, 240],
  '4h': [120, 240],
  '1d': [120, 240],
};

export const GEX_DEFAULT_LOOKBACKS: readonly [number, number] = [120, 240];

/** Minutes back of each value in GexStrike.priors, in GEXBot's order. */
export const GEX_PRIOR_MINUTES: readonly number[] = [1, 5, 10, 15, 30];

export function lookbacksFor(interval: string | null | undefined): readonly [number, number] {
  return (interval && GEX_LOOKBACKS[interval]) || GEX_DEFAULT_LOOKBACKS;
}

/** 15 -> "-15m", 60 -> "-1h", 90 -> "-90m". */
export function formatLookback(minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0 ? `-${minutes / 60}h` : `-${minutes}m`;
}

/**
 * Which priors slot the strike-bar outline uses: the interval's shorter
 * lookback capped at 30 min, snapped to the nearest slot GEXBot provides.
 */
export function priorSlotFor(interval: string | null | undefined): { index: number; minutes: number } {
  const want = Math.min(lookbacksFor(interval)[0], 30);
  let best = 0;
  for (let i = 1; i < GEX_PRIOR_MINUTES.length; i++) {
    if (Math.abs(GEX_PRIOR_MINUTES[i] - want) < Math.abs(GEX_PRIOR_MINUTES[best] - want)) best = i;
  }
  return { index: best, minutes: GEX_PRIOR_MINUTES[best] };
}

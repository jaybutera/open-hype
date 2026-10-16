/**
 * How far back the GEX lookbacks reach, per candle interval. GEXBot only
 * returns each strike's volume GEX 1, 5, 10, 15 and 30 minutes earlier
 * (GexStrike.priors), so every lookback is one of those slots and none goes
 * past 30 minutes. One table for the past-level lines, the strike-bar
 * outlines and the AI snapshot; scripts/hl-chart-mcp.mjs keeps a plain JS copy.
 */

/** Minutes back of each value in GexStrike.priors, in GEXBot's order. */
export const GEX_PRIOR_MINUTES: readonly number[] = [1, 5, 10, 15, 30];

/** Minutes back of each entry in GexData.maxPriors, in GEXBot's order. */
export const GEX_MAX_PRIOR_MINUTES: readonly number[] = [1, 5, 10, 15, 30, 60];

export interface GexLookback {
  minutes: number;
  /** Index into GexStrike.priors. */
  slot: number;
}

const BY_INTERVAL: Record<string, readonly [number, number]> = {
  '1m': [1, 5],
  '5m': [5, 10],
  '15m': [15, 30],
};

const DEFAULT_MINUTES: readonly [number, number] = [15, 30];

/** The two lookbacks for a candle interval, shorter first. */
export function lookbacksFor(interval: string | null | undefined): [GexLookback, GexLookback] {
  const [a, b] = (interval && BY_INTERVAL[interval]) || DEFAULT_MINUTES;
  return [
    { minutes: a, slot: GEX_PRIOR_MINUTES.indexOf(a) },
    { minutes: b, slot: GEX_PRIOR_MINUTES.indexOf(b) },
  ];
}

/** 5 -> "-5m", 30 -> "-30m". */
export function lookbackLabel(minutes: number): string {
  return `-${minutes}m`;
}

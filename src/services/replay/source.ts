import type { CandleData, CandleInterval } from '../../types/market.ts';

/**
 * Candle-source override installed while replay mode is active. The market
 * store consults it in loadCandles/loadMoreCandles so charts read from the
 * local recording instead of the Hyperliquid API. Lives in its own module
 * (no store imports) to avoid a market-store <-> replay-store cycle.
 */
export interface ReplayCandleSource {
  /** ~300 interval candles ending at the replay cursor (last one partial). */
  loadInitial(coin: string, interval: CandleInterval): Promise<CandleData[]>;
  /** ~300 more interval candles strictly before beforeT (open time ms). */
  loadMore(coin: string, interval: CandleInterval, beforeT: number): Promise<CandleData[]>;
}

let source: ReplayCandleSource | null = null;

export function setReplayCandleSource(s: ReplayCandleSource | null): void {
  source = s;
}

export function getReplayCandleSource(): ReplayCandleSource | null {
  return source;
}

import type { CandleData } from '../../types/market.ts';

/** A recorded BBO quote. */
export interface Tick {
  /** Quote time, ms UTC. */
  t: number;
  bid: number;
  ask: number;
}

export interface ReplayAssetInfo {
  coin: string;
  /** Open time (ms UTC) of the first recorded 1m candle. */
  firstTs: number;
  /** Open time (ms UTC) of the last recorded 1m candle. */
  lastTs: number;
  /**
   * Range with recorded BBO ticks, when this coin has any. Far narrower than
   * the 1m range — replay uses ticks inside it and 1m bars outside.
   */
  ticks?: { firstTs: number; lastTs: number };
}

/** Coins with locally recorded 1m data, with coverage range. */
export async function fetchReplayAssets(): Promise<ReplayAssetInfo[]> {
  const res = await fetch('/api/replay/assets');
  if (!res.ok) throw new Error(`replay assets: ${res.status}`);
  return res.json();
}

/** Recorded 1m candles with start <= t < end (ms UTC). */
export async function fetchReplayCandles(
  coin: string,
  start: number,
  end: number,
): Promise<CandleData[]> {
  const params = new URLSearchParams({ coin, start: String(start), end: String(end) });
  const res = await fetch(`/api/replay/candles?${params}`);
  if (!res.ok) throw new Error(`replay candles ${coin}: ${res.status}`);
  return res.json();
}

/** Recorded BBO quotes with start <= t < end (ms UTC). Range must be <= 24h. */
export async function fetchReplayTicks(
  coin: string,
  start: number,
  end: number,
): Promise<Tick[]> {
  const params = new URLSearchParams({ coin, start: String(start), end: String(end) });
  const res = await fetch(`/api/replay/ticks?${params}`);
  if (!res.ok) throw new Error(`replay ticks ${coin}: ${res.status}`);
  return res.json();
}

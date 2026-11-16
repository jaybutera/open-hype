import { postInfo } from './client.ts';
import type { Meta, AssetCtx, CandleData, CandleInterval } from '../../types/market.ts';
import type { ClearinghouseState } from '../../types/position.ts';
import type { OpenOrder } from '../../types/order.ts';

export async function fetchMeta(): Promise<Meta> {
  return postInfo<Meta>({ type: 'meta' });
}

export async function fetchMetaAndAssetCtxs(dex?: string): Promise<[Meta, AssetCtx[]]> {
  const body: Record<string, unknown> = { type: 'metaAndAssetCtxs' };
  if (dex) body.dex = dex;
  return postInfo<[Meta, AssetCtx[]]>(body);
}

export async function fetchAllMids(dex?: string): Promise<Record<string, string>> {
  const body: Record<string, unknown> = { type: 'allMids' };
  if (dex) body.dex = dex;
  return postInfo<Record<string, string>>(body);
}

export async function fetchCandles(
  coin: string,
  interval: CandleInterval,
  startTime: number,
  endTime: number,
): Promise<CandleData[]> {
  return postInfo<CandleData[]>({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  });
}

/**
 * 30s candles from the dev server's recorder (bars30.ts). Hyperliquid has no
 * sub-minute candles, so history starts when the recorder began watching the coin.
 */
export async function fetchBars30(coin: string, opts: { to?: number; limit?: number } = {}): Promise<CandleData[]> {
  const q = new URLSearchParams({ coin });
  if (opts.to !== undefined) q.set('to', String(opts.to));
  if (opts.limit !== undefined) q.set('limit', String(opts.limit));
  const r = await fetch(`/api/bars30?${q}`);
  if (!r.ok) throw new Error(`bars30 ${r.status}`);
  return ((await r.json()) as { bars: CandleData[] }).bars;
}

export async function fetchClearinghouseState(user: string): Promise<ClearinghouseState> {
  return postInfo<ClearinghouseState>({ type: 'clearinghouseState', user });
}

export async function fetchOpenOrders(user: string): Promise<OpenOrder[]> {
  return postInfo<OpenOrder[]>({ type: 'frontendOpenOrders', user });
}

export interface UserFeesResponse {
  userCrossRate: string;  // taker rate
  userAddRate: string;    // maker rate
  activeReferralDiscount: string;
  activeStakingDiscount: string;
}

export async function fetchUserFees(user: string): Promise<UserFeesResponse> {
  return postInfo<UserFeesResponse>({ type: 'userFees', user });
}

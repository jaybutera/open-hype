import { postInfo } from '../api/client.ts';

export interface RawSpotBalance { coin: string; token: number; total: string; hold: string; entryNtl?: string }
export interface RawSpotState {
  balances: RawSpotBalance[];
  /** Unified accounts only: spot amount still free after perp maintenance margin, per token index. */
  tokenToAvailableAfterMaintenance?: [number, string][];
}

export const USDC_TOKEN = 0;
const PRICE_TTL_MS = 60_000;

let priceCache: { at: number; prices: Map<number, number> } | null = null;
let inflight: Promise<Map<number, number>> | null = null;

interface RawSpotMeta {
  universe: { tokens: [number, number]; index: number }[];
}
interface RawSpotCtx { markPx: string; midPx: string | null }

/** USD price of each spot token, from its USDC-quoted pair. Cached for a minute. */
export async function loadSpotPrices(): Promise<Map<number, number>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.prices;
  inflight ??= postInfo<[RawSpotMeta, RawSpotCtx[]]>({ type: 'spotMetaAndAssetCtxs' })
    .then(([meta, ctxs]) => {
      const prices = new Map<number, number>([[USDC_TOKEN, 1]]);
      for (const pair of meta.universe) {
        const [base, quote] = pair.tokens;
        const ctx = ctxs[pair.index];
        if (quote !== USDC_TOKEN || !ctx || prices.has(base)) continue;
        const px = parseFloat(ctx.midPx ?? ctx.markPx);
        if (px > 0) prices.set(base, px);
      }
      priceCache = { at: Date.now(), prices };
      return prices;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Test hook: forget cached spot prices. */
export function clearSpotPriceCache(): void { priceCache = null; }

const held = (b: RawSpotBalance) => parseFloat(b.total) !== 0;

/** True when any non-USDC token is held, i.e. pricing is needed to value the spot account. */
export function needsSpotPrices(balances: RawSpotBalance[]): boolean {
  return balances.some(b => b.token !== USDC_TOKEN && held(b));
}

/** USD value of a spot balance. USDC counts 1:1; tokens with no known price count 0. */
export function spotBalanceUsd(b: RawSpotBalance, prices?: Map<number, number>): number {
  const px = b.token === USDC_TOKEN ? 1 : prices?.get(b.token) ?? 0;
  return parseFloat(b.total) * px;
}

export function spotUsdValue(balances: RawSpotBalance[], prices?: Map<number, number>): number {
  return balances.filter(held).reduce((a, b) => a + spotBalanceUsd(b, prices), 0);
}

/** USDC that can leave the spot account: unified accounts report it net of perp maintenance margin. */
export function spotUsdcAvailable(s: RawSpotState): number {
  const unified = s.tokenToAvailableAfterMaintenance?.find(([t]) => t === USDC_TOKEN);
  if (unified) return parseFloat(unified[1]);
  const usdc = s.balances.find(b => b.token === USDC_TOKEN);
  return usdc ? parseFloat(usdc.total) - parseFloat(usdc.hold) : 0;
}

/** Spot value of a user, pricing non-USDC tokens only when they hold any. */
export async function valueSpot(balances: RawSpotBalance[]): Promise<number> {
  const prices = needsSpotPrices(balances) ? await loadSpotPrices().catch(() => undefined) : undefined;
  return spotUsdValue(balances, prices);
}

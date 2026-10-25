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

/** `userAbstraction` answer: "default"/"disabled" standard, "unifiedAccount", "portfolioMargin". */
export type AccountAbstraction = string;
const ABSTRACTION_TTL_MS = 10 * 60_000;
const abstractionCache = new Map<string, { at: number; value: AccountAbstraction }>();

/**
 * Account mode of a user, cached ten minutes so balance polls do not add a request each tick.
 * Null when the lookup fails; that result is not cached.
 */
export async function loadAbstraction(user: string): Promise<AccountAbstraction | null> {
  const key = user.toLowerCase();
  const hit = abstractionCache.get(key);
  if (hit && Date.now() - hit.at < ABSTRACTION_TTL_MS) return hit.value;
  try {
    const value = await postInfo<unknown>({ type: 'userAbstraction', user });
    if (typeof value !== 'string') return null;
    abstractionCache.set(key, { at: Date.now(), value });
    return value;
  } catch { return null; }
}

/** Test hook: forget cached account modes. */
export function clearAbstractionCache(): void { abstractionCache.clear(); }

/**
 * Unified and portfolio-margin accounts post perp margin from spot: spotClearinghouseState
 * balances already include perp equity on every dex, so perp accountValue must not be added on top.
 * When the mode lookup failed, the unified-only `tokenToAvailableAfterMaintenance` field decides.
 */
export function spotCarriesPerpEquity(abstraction: AccountAbstraction | null, spot?: RawSpotState | null): boolean {
  if (abstraction == null) return !!spot?.tokenToAvailableAfterMaintenance;
  return abstraction === 'unifiedAccount' || abstraction === 'portfolioMargin';
}

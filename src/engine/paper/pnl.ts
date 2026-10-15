import Decimal from 'decimal.js';

/**
 * Calculate the fee for a fill using the provided rates.
 */
export function calculateFee(fillSize: Decimal, fillPrice: Decimal, isMaker: boolean, makerRate: string, takerRate: string): Decimal {
  const rate = new Decimal(isMaker ? makerRate : takerRate);
  return fillSize.mul(fillPrice).mul(rate);
}

/** Fee settings of a HIP-3 market, from its dex meta. */
export interface DexFee {
  deployerFeeScale: number;
  growthMode: boolean;
}

/**
 * Scale validator-perp rates to a HIP-3 market's rates. Formula from
 * https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees, without the
 * referral and aligned-quote terms (USDC-quoted dexes are not aligned).
 */
export function hip3Rates(makerRate: string, takerRate: string, fee: DexFee): { makerRate: string; takerRate: string } {
  const s = fee.deployerFeeScale;
  const scale = s < 1 ? s + 1 : 2 * s;
  const growth = fee.growthMode ? 0.1 : 1;
  let maker = new Decimal(makerRate).mul(growth);
  if (maker.gt(0)) maker = maker.mul(scale);
  return { makerRate: maker.toString(), takerRate: new Decimal(takerRate).mul(scale).mul(growth).toString() };
}

/**
 * Calculate return on equity (ROE) for a position.
 */
export function calculateRoe(
  unrealizedPnl: Decimal,
  marginUsed: Decimal,
): Decimal {
  if (marginUsed.isZero()) return new Decimal(0);
  return unrealizedPnl.div(marginUsed);
}

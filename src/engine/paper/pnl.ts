import Decimal from 'decimal.js';

/**
 * Calculate the fee for a fill using the provided rates.
 */
export function calculateFee(fillSize: Decimal, fillPrice: Decimal, isMaker: boolean, makerRate: string, takerRate: string): Decimal {
  const rate = new Decimal(isMaker ? makerRate : takerRate);
  return fillSize.mul(fillPrice).mul(rate);
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

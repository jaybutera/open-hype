import Decimal from 'decimal.js';
import type { OptionPosition } from './OptionPosition.ts';
import { CONTRACT_MULTIPLIER } from './OptionPosition.ts';

/**
 * Per-share intrinsic value at expiration.
 * Call: max(0, S - K). Put: max(0, K - S). American vs European irrelevant
 * at expiration — intrinsic is the same.
 */
export function legIntrinsicAtExpiration(
  leg: Pick<OptionPosition, 'type' | 'strike'>,
  underlyingPrice: Decimal,
): Decimal {
  if (leg.type === 'call') {
    const v = underlyingPrice.sub(leg.strike);
    return v.gt(0) ? v : new Decimal(0);
  }
  const v = leg.strike.sub(underlyingPrice);
  return v.gt(0) ? v : new Decimal(0);
}

export interface SettlementDraft {
  leg: OptionPosition;
  intrinsic: Decimal;       // per-share cash value at expiration
  cashDelta: Decimal;       // signed cash delta to balance (szi * intrinsic * 100)
  realizedPnl: Decimal;     // (intrinsic - entryPx) * szi * 100
  closeSide: 'buy' | 'sell';
  inTheMoney: boolean;
}

/**
 * Build a settlement draft for a single expired leg. Pure helper — mutates
 * nothing; the engine's settleExpired path consumes these drafts.
 */
export function buildSettlementDraft(
  leg: OptionPosition,
  underlyingPrice: Decimal,
): SettlementDraft {
  const intrinsic = legIntrinsicAtExpiration(leg, underlyingPrice);
  const cashDelta = leg.szi.mul(intrinsic).mul(CONTRACT_MULTIPLIER);
  const realizedPnl = intrinsic.sub(leg.entryPx).mul(leg.szi).mul(CONTRACT_MULTIPLIER);
  // At expiration a long position "sells" into cash settlement; a short
  // "buys" back for cash. Mirrors the close-side convention in closeOptionSpread.
  const closeSide: 'buy' | 'sell' = leg.szi.gt(0) ? 'sell' : 'buy';
  return {
    leg,
    intrinsic,
    cashDelta,
    realizedPnl,
    closeSide,
    inTheMoney: intrinsic.gt(0),
  };
}

/**
 * Which legs from `positions` are expired at `nowSec` AND have a known
 * underlying price in `prices`. Legs for underlyings without a price stay
 * open (engine can't settle them without a last price).
 */
export function selectSettleableLegs(
  positions: OptionPosition[],
  prices: Map<string, Decimal>,
  nowSec: number,
): Array<{ leg: OptionPosition; underlyingPrice: Decimal }> {
  const out: Array<{ leg: OptionPosition; underlyingPrice: Decimal }> = [];
  for (const leg of positions) {
    if (leg.expiration > nowSec) continue;
    const price = prices.get(leg.underlying);
    if (!price) continue;
    out.push({ leg, underlyingPrice: price });
  }
  return out;
}

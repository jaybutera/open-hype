import type { Leg } from './types.ts';
import { blackScholes, yearsUntil, type Greeks } from './greeks.ts';

export const CONTRACT_MULTIPLIER = 100;

export interface LegMark {
  /** Mid price per contract; falls back to bid, ask, or last when a side is 0. */
  mark: number;
  /** True if both bid and ask are > 0. Indicates a reliable quote. */
  reliable: boolean;
}

/**
 * Mid price for a single leg. If both bid and ask are present returns their
 * average; otherwise returns whichever side is > 0, falling back to last.
 * Returns 0 if nothing usable is available.
 */
export function legMark(leg: Leg): LegMark {
  const { bid, ask, last } = leg.contract;
  if (bid > 0 && ask > 0) return { mark: (bid + ask) / 2, reliable: true };
  if (bid > 0) return { mark: bid, reliable: false };
  if (ask > 0) return { mark: ask, reliable: false };
  if (last > 0) return { mark: last, reliable: false };
  return { mark: 0, reliable: false };
}

/**
 * Signed per-share net debit/credit for a single leg at its mark, ignoring
 * quantity and the contract multiplier. Buys are positive (debit), sells are
 * negative (credit).
 */
export function legSignedMark(leg: Leg): number {
  const { mark } = legMark(leg);
  return leg.side === 'buy' ? mark : -mark;
}

/**
 * Sum of signed marks across all legs, per share. Positive = net debit
 * (you pay to open), negative = net credit (you receive to open).
 */
export function netPerShare(legs: Leg[]): number {
  return legs.reduce((acc, l) => acc + legSignedMark(l) * l.qty, 0);
}

/**
 * Total dollar cost to open the spread — per-share net × contract multiplier
 * × the order-level qty scalar. Positive = debit, negative = credit.
 */
export function netTotal(legs: Leg[], qtyScalar: number = 1): number {
  return netPerShare(legs) * CONTRACT_MULTIPLIER * qtyScalar;
}

/** Greeks contribution of a single leg, signed by side and scaled by qty. */
export function legGreeks(leg: Leg, underlyingPrice: number, nowUnixSeconds?: number): Greeks {
  const { contract } = leg;
  const T = yearsUntil(contract.expiration, nowUnixSeconds);
  const g = blackScholes({
    underlyingPrice,
    strike: contract.strike,
    timeToExpiry: T,
    volatility: contract.iv,
    type: contract.type,
  });
  const sign = leg.side === 'buy' ? 1 : -1;
  const k = sign * leg.qty;
  return {
    price: g.price * k,
    delta: g.delta * k,
    gamma: g.gamma * k,
    vega: g.vega * k,
    theta: g.theta * k,
    rho: g.rho * k,
  };
}

/** Summed net Greeks across all legs. */
export function netGreeks(legs: Leg[], underlyingPrice: number, nowUnixSeconds?: number): Greeks {
  const zero: Greeks = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  return legs.reduce<Greeks>((acc, l) => {
    const g = legGreeks(l, underlyingPrice, nowUnixSeconds);
    return {
      price: acc.price + g.price,
      delta: acc.delta + g.delta,
      gamma: acc.gamma + g.gamma,
      vega: acc.vega + g.vega,
      theta: acc.theta + g.theta,
      rho: acc.rho + g.rho,
    };
  }, zero);
}

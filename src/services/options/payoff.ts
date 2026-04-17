import type { Leg } from './types.ts';
import { blackScholes, yearsUntil } from './greeks.ts';
import { CONTRACT_MULTIPLIER, legMark } from './netSummary.ts';

export interface PayoffSample {
  /** Underlying price at this sample. */
  price: number;
  /** Total P&L in dollars if held to expiration and all legs settle at intrinsic value. */
  expiration: number;
  /** Total P&L in dollars priced today with Black-Scholes (per-leg IV, same `now`). */
  today: number;
}

export interface PayoffCurve {
  samples: PayoffSample[];
  /** Domain min (underlying price). */
  xMin: number;
  /** Domain max (underlying price). */
  xMax: number;
  /** Range over both series. */
  yMin: number;
  yMax: number;
  /** Zero-crossings of the expiration curve — break-even underlying prices. */
  breakevens: number[];
}

/**
 * Per-share intrinsic value of a single long contract at a given underlying price.
 */
export function contractIntrinsic(
  type: 'call' | 'put',
  strike: number,
  underlyingPrice: number,
): number {
  return type === 'call'
    ? Math.max(0, underlyingPrice - strike)
    : Math.max(0, strike - underlyingPrice);
}

/**
 * Total P&L at expiration for a basket of legs at an underlying price S.
 * Sums (intrinsic - entry_mark) × signed_qty × 100 across legs.
 * Entry mark comes from each leg's current mid (`legMark`) — the user's
 * planned fill price on a "live" submit.
 */
export function expirationPnl(legs: Leg[], S: number, qtyScalar: number = 1): number {
  let total = 0;
  for (const leg of legs) {
    const intrinsic = contractIntrinsic(leg.contract.type, leg.contract.strike, S);
    const entry = legMark(leg).mark;
    const sign = leg.side === 'buy' ? 1 : -1;
    const perShare = sign * (intrinsic - entry);
    total += perShare * leg.qty * qtyScalar * CONTRACT_MULTIPLIER;
  }
  return total;
}

/**
 * Total P&L priced today for a basket of legs. Uses Black-Scholes with each
 * leg's implied volatility to compute the current theoretical price at a
 * hypothetical underlying S, and subtracts the entry mark. Useful for the
 * dotted "today" curve overlaying the solid expiration payoff.
 *
 * Legs whose time-to-expiry is <= 0 or IV is <= 0 fall back to intrinsic —
 * same as Black-Scholes' degenerate branch. That matches expiration-day
 * behavior where today and expiration curves converge.
 */
export function todayPnl(legs: Leg[], S: number, nowSec: number, qtyScalar: number = 1): number {
  let total = 0;
  for (const leg of legs) {
    const T = yearsUntil(leg.contract.expiration, nowSec);
    const iv = leg.contract.iv;
    const today = blackScholes({
      underlyingPrice: S,
      strike: leg.contract.strike,
      timeToExpiry: T,
      volatility: iv,
      type: leg.contract.type,
    }).price;
    const entry = legMark(leg).mark;
    const sign = leg.side === 'buy' ? 1 : -1;
    const perShare = sign * (today - entry);
    total += perShare * leg.qty * qtyScalar * CONTRACT_MULTIPLIER;
  }
  return total;
}

/**
 * Linear interpolation between two P&L samples to find a zero-crossing
 * underlying price. Returns null if the two samples share a sign or if both
 * are zero (no unambiguous crossing).
 */
function crossing(x0: number, y0: number, x1: number, y1: number): number | null {
  if (y0 === 0 && y1 === 0) return null;
  if (y0 === 0) return x0;
  if (y1 === 0) return x1;
  if (Math.sign(y0) === Math.sign(y1)) return null;
  const t = y0 / (y0 - y1);
  return x0 + t * (x1 - x0);
}

/**
 * Find break-even underlying prices from an expiration-curve sample array —
 * zero-crossings via linear interpolation. Returns them sorted ascending.
 */
export function findBreakevens(samples: PayoffSample[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const b = crossing(
      samples[i - 1].price, samples[i - 1].expiration,
      samples[i].price, samples[i].expiration,
    );
    if (b !== null) result.push(b);
  }
  return result;
}

export interface BuildPayoffOptions {
  /** Fractional half-width around the underlying price. Default 0.3 = ±30%. */
  rangePct?: number;
  /** Number of samples across the x-axis. Default 121. */
  samples?: number;
  /** Per-leg qty multiplier. Default 1. */
  qtyScalar?: number;
  /** Unix seconds used as "today" for the BS curve. Default = process now. */
  nowSec?: number;
}

/**
 * Build a payoff curve for a set of legs around a center underlying price.
 * Generates evenly-spaced samples, computes expiration and today P&L at each,
 * and extracts break-even prices from the expiration curve.
 */
export function buildPayoffCurve(
  legs: Leg[],
  centerPrice: number,
  opts: BuildPayoffOptions = {},
): PayoffCurve {
  const rangePct = opts.rangePct ?? 0.3;
  const count = Math.max(3, opts.samples ?? 121);
  const qtyScalar = opts.qtyScalar ?? 1;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);

  const xMin = Math.max(0, centerPrice * (1 - rangePct));
  const xMax = centerPrice * (1 + rangePct);
  const step = (xMax - xMin) / (count - 1);

  const samples: PayoffSample[] = [];
  let yMin = 0;
  let yMax = 0;
  for (let i = 0; i < count; i++) {
    const price = xMin + i * step;
    const expiration = expirationPnl(legs, price, qtyScalar);
    const today = todayPnl(legs, price, nowSec, qtyScalar);
    samples.push({ price, expiration, today });
    if (expiration < yMin) yMin = expiration;
    if (today < yMin) yMin = today;
    if (expiration > yMax) yMax = expiration;
    if (today > yMax) yMax = today;
  }

  const breakevens = findBreakevens(samples);
  return { samples, xMin, xMax, yMin, yMax, breakevens };
}

/**
 * Analytical break-even underlying prices for a basket of legs at expiration.
 *
 * Unlike `findBreakevens` (which samples 121 points and linearly interpolates),
 * this exploits the fact that the expiration P&L is piecewise-linear with kinks
 * only at the strike prices. Between adjacent strikes the function is strictly
 * linear, so the zero-crossing within a segment can be located exactly with a
 * single linear interpolation — no sampling resolution compromise.
 *
 * Returns break-evens sorted ascending. A payoff that sits exactly on zero
 * over a whole segment (all four legs cancel on that range) is ignored: only
 * sign-changes are reported. The S=0 and far-right anchors cover the tails.
 */
export function analyticalBreakevens(legs: Leg[], qtyScalar: number = 1): number[] {
  if (legs.length === 0) return [];

  const strikes = legs.map((l) => l.contract.strike);
  const maxStrike = Math.max(...strikes, 0);
  const probe = maxStrike * 2 + 1;

  const pivots = new Set<number>();
  pivots.add(0);
  for (const k of strikes) pivots.add(k);
  pivots.add(probe);

  const sorted = Array.from(pivots).sort((a, b) => a - b);
  const result: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const x0 = sorted[i - 1];
    const x1 = sorted[i];
    const y0 = expirationPnl(legs, x0, qtyScalar);
    const y1 = expirationPnl(legs, x1, qtyScalar);
    const b = crossing(x0, y0, x1, y1);
    if (b === null) continue;
    if (result.length > 0 && Math.abs(result[result.length - 1] - b) < 1e-9) continue;
    result.push(b);
  }
  return result;
}

export interface PayoffExtrema {
  /**
   * Max profit in dollars at expiration. `bounded` indicates whether the
   * payoff is capped on the upside — if unbounded (e.g. long call), `value` is
   * still the best value observed at the high-side tail but should be shown as
   * "Unlimited" to the user.
   */
  maxProfit: { value: number; bounded: boolean; atPrice: number };
  /** Max loss (negative or zero) in dollars at expiration. Same bounded semantics. */
  maxLoss: { value: number; bounded: boolean; atPrice: number };
}

/**
 * Slope of the signed per-share expiration payoff as S → +∞ (right tail).
 * At very high underlying prices: every put is worthless, every call has
 * intrinsic S-K, so each call contributes `+qty × sign` to the slope.
 *
 * Only the right tail is tracked — S is physically floored at 0, so the left
 * "tail" is really just the S=0 boundary, which is enumerated explicitly in
 * the candidate list.
 */
function rightTailSlope(legs: Leg[], qtyScalar: number = 1): number {
  let s = 0;
  for (const leg of legs) {
    if (leg.contract.type !== 'call') continue;
    const sign = leg.side === 'buy' ? 1 : -1;
    s += sign * leg.qty * qtyScalar;
  }
  return s * CONTRACT_MULTIPLIER;
}

/**
 * Maximum profit / maximum loss for a basket of option legs at expiration.
 * Uses the piecewise-linear nature of option payoffs: extrema occur at one of
 * {S=0, each strike, S→∞}. Samples the payoff at each candidate price and
 * reports the best/worst. The `bounded` flag uses the right-tail slope — the
 * only side that can actually diverge, since S is floored at 0.
 *
 * Returns `{maxProfit: {value: 0, bounded: true, atPrice: 0}, maxLoss: same}`
 * for empty legs.
 */
export function expirationExtrema(
  legs: Leg[],
  qtyScalar: number = 1,
): PayoffExtrema {
  if (legs.length === 0) {
    return {
      maxProfit: { value: 0, bounded: true, atPrice: 0 },
      maxLoss: { value: 0, bounded: true, atPrice: 0 },
    };
  }

  const strikes = legs.map((l) => l.contract.strike);
  const candidates = new Set<number>();
  candidates.add(0);
  for (const k of strikes) candidates.add(k);
  // A far-right probe — anchors the evaluation so we can read the right-tail
  // value at a concrete sample. The exact distance doesn't matter for a
  // bounded payoff (slope is 0 there), and for an unbounded payoff we only
  // use the slope — not the probed value — to label as "Unlimited".
  const maxStrike = Math.max(...strikes, 0);
  candidates.add(maxStrike * 2 + 1);

  const sorted = Array.from(candidates).sort((a, b) => a - b);
  let bestProfit = -Infinity;
  let bestProfitAt = sorted[0];
  let worstLoss = Infinity;
  let worstLossAt = sorted[0];
  for (const S of sorted) {
    const v = expirationPnl(legs, S, qtyScalar);
    if (v > bestProfit) {
      bestProfit = v;
      bestProfitAt = S;
    }
    if (v < worstLoss) {
      worstLoss = v;
      worstLossAt = S;
    }
  }

  // Only the right tail can actually diverge — S is physically floored at 0
  // (stock prices can't go negative), so a "left-unbounded" payoff is really
  // just bounded at S=0 and already enumerated above.
  const rightSlope = rightTailSlope(legs, qtyScalar);
  const profitBounded = rightSlope <= 0;
  const lossBounded = rightSlope >= 0;

  return {
    maxProfit: { value: bestProfit, bounded: profitBounded, atPrice: bestProfitAt },
    maxLoss: { value: worstLoss, bounded: lossBounded, atPrice: worstLossAt },
  };
}

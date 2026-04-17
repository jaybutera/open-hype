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

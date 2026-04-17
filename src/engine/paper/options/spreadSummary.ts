import Decimal from 'decimal.js';
import type { OptionChain, OptionContract } from '../../../services/options/types.ts';
import { blackScholes, yearsUntil, type Greeks } from '../../../services/options/greeks.ts';
import { classifyShapes, type LegShape } from '../../../services/options/strategy.ts';
import {
  CONTRACT_MULTIPLIER,
  legCostBasis,
  legUnrealizedPnl,
  type OptionPosition,
} from './OptionPosition.ts';

export interface SpreadMarkResult {
  /** Per-share signed mark: positive = net long value, negative = net short. */
  netMarkPerShare: Decimal;
  /** Total dollar mark across all legs (× contract multiplier). */
  netMarkTotal: Decimal;
  /** Number of legs that had a usable live quote. */
  legsPriced: number;
  /** Total number of legs. */
  legCount: number;
}

/**
 * Net entry debit/credit for a spread. Positive = debit (cash out at open),
 * negative = credit (cash in at open). Sums the signed per-leg cost basis.
 */
export function spreadEntryBasis(legs: OptionPosition[]): Decimal {
  return legs.reduce<Decimal>((acc, l) => acc.add(legCostBasis(l)), new Decimal(0));
}

function findContractMark(chain: OptionChain, leg: OptionPosition): number | null {
  if (chain.underlying.toUpperCase() !== leg.underlying.toUpperCase()) return null;
  const pool: OptionContract[] = leg.type === 'call' ? chain.calls : chain.puts;
  const hit = pool.find((c) => c.symbol === leg.contractSymbol);
  if (!hit) return null;
  const { bid, ask, last } = hit;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (bid > 0) return bid;
  if (ask > 0) return ask;
  if (last > 0) return last;
  return null;
}

/**
 * Current mark for the spread using a live chain when it matches the spread's
 * underlying. Legs without a live quote fall back to their entry price so the
 * mark remains meaningful for cross-underlying spreads. `legsPriced` reflects
 * how many legs actually got a live mark.
 */
export function spreadCurrentMark(
  legs: OptionPosition[],
  chain: OptionChain | null,
): SpreadMarkResult {
  let legsPriced = 0;
  let total = new Decimal(0);
  for (const l of legs) {
    const live = chain ? findContractMark(chain, l) : null;
    const mark = live !== null ? new Decimal(live) : l.entryPx;
    if (live !== null) legsPriced += 1;
    total = total.add(l.szi.mul(mark));
  }
  return {
    netMarkPerShare: total,
    netMarkTotal: total.mul(CONTRACT_MULTIPLIER),
    legsPriced,
    legCount: legs.length,
  };
}

/**
 * Unrealized dollar PnL for the spread. Uses live marks when available (chain
 * matches underlying + contract symbol); falls back to entry price, yielding
 * 0 PnL for that leg. Positive = profit, negative = loss.
 */
export function spreadUnrealizedPnl(
  legs: OptionPosition[],
  chain: OptionChain | null,
): Decimal {
  let pnl = new Decimal(0);
  for (const l of legs) {
    const live = chain ? findContractMark(chain, l) : null;
    if (live === null) continue;
    pnl = pnl.add(legUnrealizedPnl(l, new Decimal(live)));
  }
  return pnl;
}

/**
 * Net Greeks for the spread using Black-Scholes at the given underlying price.
 * Each leg's Greeks are signed by `szi` (long positive, short negative) and
 * summed. Requires an underlying price — returns zeros when not provided.
 */
export function spreadNetGreeks(
  legs: OptionPosition[],
  underlyingPrice: number | null,
  nowUnixSeconds?: number,
): Greeks {
  const zero: Greeks = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  if (underlyingPrice === null || underlyingPrice <= 0) return zero;
  return legs.reduce<Greeks>((acc, l) => {
    const T = yearsUntil(l.expiration, nowUnixSeconds);
    // IV is not stored on the position; pass a sane default so downstream math
    // still produces useful Greeks. Callers that have the chain can pass per-leg
    // IV via `spreadNetGreeksWithIv` when that's added.
    const iv = 0.3;
    const g = blackScholes({
      underlyingPrice,
      strike: l.strike.toNumber(),
      timeToExpiry: T,
      volatility: iv,
      type: l.type,
    });
    const k = l.szi.toNumber();
    return {
      price: acc.price + g.price * k,
      delta: acc.delta + g.delta * k,
      gamma: acc.gamma + g.gamma * k,
      vega: acc.vega + g.vega * k,
      theta: acc.theta + g.theta * k,
      rho: acc.rho + g.rho * k,
    };
  }, zero);
}

/**
 * Net Greeks using live IV from the matching chain when available; falls back
 * to a flat 0.3 IV for legs without a quote. Lets the positions view produce
 * chain-accurate Greeks for spreads on the currently-loaded underlying.
 */
export function spreadNetGreeksFromChain(
  legs: OptionPosition[],
  chain: OptionChain | null,
  nowUnixSeconds?: number,
): Greeks {
  const zero: Greeks = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  if (!chain || chain.underlyingPrice <= 0) return zero;
  return legs.reduce<Greeks>((acc, l) => {
    if (chain.underlying.toUpperCase() !== l.underlying.toUpperCase()) return acc;
    const pool: OptionContract[] = l.type === 'call' ? chain.calls : chain.puts;
    const hit = pool.find((c) => c.symbol === l.contractSymbol);
    const iv = hit && hit.iv > 0 ? hit.iv : 0.3;
    const T = yearsUntil(l.expiration, nowUnixSeconds);
    const g = blackScholes({
      underlyingPrice: chain.underlyingPrice,
      strike: l.strike.toNumber(),
      timeToExpiry: T,
      volatility: iv,
      type: l.type,
    });
    const k = l.szi.toNumber();
    return {
      price: acc.price + g.price * k,
      delta: acc.delta + g.delta * k,
      gamma: acc.gamma + g.gamma * k,
      vega: acc.vega + g.vega * k,
      theta: acc.theta + g.theta * k,
      rho: acc.rho + g.rho * k,
    };
  }, zero);
}

/**
 * Days to expiration for the nearest-expiring leg. Returns a whole-day count
 * rounded down (so an expiration 4.5 days out reports 4). Negative when every
 * leg has expired; 0 when the nearest leg expires today.
 */
export function spreadNearestDte(legs: OptionPosition[], nowUnixSeconds?: number): number {
  if (legs.length === 0) return 0;
  const now = nowUnixSeconds ?? Date.now() / 1000;
  const nearest = Math.min(...legs.map((l) => l.expiration));
  return Math.floor((nearest - now) / 86400);
}

/**
 * Farthest-expiring leg's DTE. Useful when every leg has the same expiration
 * (vertical, straddle) — nearest equals farthest — but distinguishable for
 * calendars/diagonals.
 */
export function spreadFarthestDte(legs: OptionPosition[], nowUnixSeconds?: number): number {
  if (legs.length === 0) return 0;
  const now = nowUnixSeconds ?? Date.now() / 1000;
  const farthest = Math.max(...legs.map((l) => l.expiration));
  return Math.floor((farthest - now) / 86400);
}

function positionToShape(p: OptionPosition): LegShape {
  return {
    type: p.type,
    strike: p.strike.toNumber(),
    expiration: p.expiration,
    signedQty: p.szi.toNumber(),
  };
}

/**
 * Strategy classifier. Recognizes common 1-4 leg strategies (Verticals,
 * Straddle, Strangle, Calendar, Diagonal, Ratio, Butterfly, Iron Condor /
 * Butterfly, including broken-wing variants). Pure and order-independent;
 * multi-leg patterns are bucketed by strike internally.
 *
 * Thin adapter over `classifyShapes` in `services/options/strategy.ts` — the
 * UI-side `Leg[]` classifier shares that implementation. Falls back to
 * `${n}-leg spread` for unrecognized shapes.
 */
export function detectSimpleStrategy(legs: OptionPosition[]): string {
  return classifyShapes(legs.map(positionToShape));
}

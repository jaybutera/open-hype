import Decimal from 'decimal.js';
import type { OptionChain, OptionContract } from '../../../services/options/types.ts';
import { blackScholes, yearsUntil, type Greeks } from '../../../services/options/greeks.ts';
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

interface StrikeBucket {
  strike: Decimal;
  netQty: Decimal; // summed szi at this strike/type/exp
  longQty: Decimal; // sum of positive szi
  shortQty: Decimal; // sum of abs(negative szi)
}

function bucketByStrike(legs: OptionPosition[]): StrikeBucket[] {
  const map = new Map<string, StrikeBucket>();
  for (const l of legs) {
    const key = l.strike.toString();
    const existing = map.get(key);
    if (existing) {
      existing.netQty = existing.netQty.add(l.szi);
      if (l.szi.gt(0)) existing.longQty = existing.longQty.add(l.szi);
      else existing.shortQty = existing.shortQty.add(l.szi.abs());
    } else {
      map.set(key, {
        strike: l.strike,
        netQty: l.szi,
        longQty: l.szi.gt(0) ? l.szi : new Decimal(0),
        shortQty: l.szi.lt(0) ? l.szi.abs() : new Decimal(0),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.strike.cmp(b.strike));
}

function allSameExpiration(legs: OptionPosition[]): boolean {
  return legs.every((l) => l.expiration === legs[0].expiration);
}

function allSameType(legs: OptionPosition[], type?: 'call' | 'put'): boolean {
  const t = type ?? legs[0].type;
  return legs.every((l) => l.type === t);
}

/**
 * Classify a 3-leg (or normalized 4-leg with a doubled middle) butterfly.
 * Body qty = 2× wing qty, same type, same exp, opposing sides (body short
 * if wings long, or vice versa). Returns null when not a butterfly.
 */
function detectButterfly(legs: OptionPosition[]): string | null {
  if (!allSameExpiration(legs)) return null;
  if (!allSameType(legs)) return null;
  const buckets = bucketByStrike(legs);
  if (buckets.length !== 3) return null;
  const [low, mid, hi] = buckets;

  // Wings must be same direction; body must be opposite direction.
  // Check: low.netQty and hi.netQty same sign, mid.netQty opposite sign.
  const lowSign = low.netQty.cmp(0);
  const midSign = mid.netQty.cmp(0);
  const hiSign = hi.netQty.cmp(0);
  if (lowSign === 0 || midSign === 0 || hiSign === 0) return null;
  if (lowSign !== hiSign) return null;
  if (midSign === lowSign) return null;

  // Body qty must equal 2× wing qty, and wing qtys must match each other.
  const wingQty = low.netQty.abs();
  if (!hi.netQty.abs().eq(wingQty)) return null;
  if (!mid.netQty.abs().eq(wingQty.mul(2))) return null;

  const type = legs[0].type === 'call' ? 'Call' : 'Put';
  const direction = low.netQty.gt(0) ? 'Long' : 'Short';

  // Broken-wing if strike distances differ.
  const lowerWidth = mid.strike.sub(low.strike);
  const upperWidth = hi.strike.sub(mid.strike);
  if (!lowerWidth.eq(upperWidth)) {
    return `${direction} Broken-Wing ${type} Butterfly`;
  }
  return `${direction} ${type} Butterfly`;
}

/**
 * Classify a 4-leg iron condor / iron butterfly.
 * - 2 calls + 2 puts, same exp
 * - Put side: 1 long + 1 short, both below underlying (short put strike > long put strike)
 * - Call side: 1 long + 1 short, both above underlying (short call strike < long call strike)
 * - If short put strike == short call strike: Iron Butterfly (Iron Fly)
 * - Otherwise: Iron Condor; broken-wing if wing widths differ
 * Returns null when not an iron-family spread.
 */
function detectIron(legs: OptionPosition[]): string | null {
  if (!allSameExpiration(legs)) return null;
  const calls = legs.filter((l) => l.type === 'call');
  const puts = legs.filter((l) => l.type === 'put');
  if (calls.length !== 2 || puts.length !== 2) return null;

  // Each side must be a vertical (one long, one short, same abs qty).
  const callLong = calls.find((l) => l.szi.gt(0));
  const callShort = calls.find((l) => l.szi.lt(0));
  const putLong = puts.find((l) => l.szi.gt(0));
  const putShort = puts.find((l) => l.szi.lt(0));
  if (!callLong || !callShort || !putLong || !putShort) return null;

  const qty = callLong.szi.abs();
  if (
    !callShort.szi.abs().eq(qty) ||
    !putLong.szi.abs().eq(qty) ||
    !putShort.szi.abs().eq(qty)
  ) {
    return null;
  }

  // Strike ordering for a short iron condor / iron fly:
  //   putLong.strike < putShort.strike <= callShort.strike < callLong.strike
  // For a (rare) long iron condor the sides would flip; handle that too.
  const shortIron =
    putLong.strike.lt(putShort.strike) &&
    putShort.strike.lte(callShort.strike) &&
    callShort.strike.lt(callLong.strike);

  // "Long" iron: long body / short wings — swap role check.
  const callLongFlip = calls.find((l) => l.szi.lt(0));
  const callShortFlip = calls.find((l) => l.szi.gt(0));
  const putLongFlip = puts.find((l) => l.szi.lt(0));
  const putShortFlip = puts.find((l) => l.szi.gt(0));
  const longIron =
    callLongFlip &&
    callShortFlip &&
    putLongFlip &&
    putShortFlip &&
    putLongFlip.strike.lt(putShortFlip.strike) &&
    putShortFlip.strike.lte(callShortFlip.strike) &&
    callShortFlip.strike.lt(callLongFlip.strike);

  if (!shortIron && !longIron) return null;

  const direction = shortIron ? 'Short' : 'Long';
  const bodyPut = shortIron ? putShort : putShortFlip!;
  const bodyCall = shortIron ? callShort : callShortFlip!;
  const wingPut = shortIron ? putLong : putLongFlip!;
  const wingCall = shortIron ? callLong : callLongFlip!;

  const ironFly = bodyPut.strike.eq(bodyCall.strike);
  if (ironFly) {
    return `${direction} Iron Butterfly`;
  }

  const lowerWidth = bodyPut.strike.sub(wingPut.strike);
  const upperWidth = wingCall.strike.sub(bodyCall.strike);
  if (!lowerWidth.eq(upperWidth)) {
    return `${direction} Broken-Wing Iron Condor`;
  }
  return `${direction} Iron Condor`;
}

/**
 * 2-leg ratio spread: same type, same exp, different strikes, different
 * absolute qtys (e.g. long 1 × short 2). Returns null when not a ratio.
 */
function detectRatio(legs: OptionPosition[]): string | null {
  if (legs.length !== 2) return null;
  const [a, b] = legs;
  if (a.expiration !== b.expiration) return null;
  if (a.type !== b.type) return null;
  if (a.strike.eq(b.strike)) return null;
  const opposing = a.szi.gt(0) !== b.szi.gt(0);
  if (!opposing) return null;
  if (a.szi.abs().eq(b.szi.abs())) return null;

  const type = a.type === 'call' ? 'Call' : 'Put';
  // Back-ratio: net long (more long contracts than short). Front-ratio: net short.
  const netQty = a.szi.add(b.szi);
  const kind = netQty.gt(0) ? 'Back' : 'Front';
  return `${type} Ratio ${kind}spread`;
}

/**
 * Strategy classifier. Recognizes common 1-4 leg strategies:
 * - 1 leg: Long/Short Call/Put
 * - 2 leg: Verticals, Straddle, Strangle, Calendar, Diagonal, Ratio spreads
 * - 3 leg: Butterflies (including Broken-Wing)
 * - 4 leg: Iron Condor, Iron Butterfly, Broken-Wing Iron Condor,
 *          normalized Butterflies (1 long / 2 short / 1 long stored as 4 legs)
 *
 * Falls back to `${n}-leg spread` for unrecognized shapes. Pure function —
 * order-independent on legs (uses bucket-by-strike for multi-leg patterns).
 */
export function detectSimpleStrategy(legs: OptionPosition[]): string {
  if (legs.length === 0) return 'Empty';
  if (legs.length === 1) {
    const l = legs[0];
    const long = l.szi.gt(0);
    if (l.type === 'call') return long ? 'Long Call' : 'Short Call';
    return long ? 'Long Put' : 'Short Put';
  }
  if (legs.length === 2) {
    const ratio = detectRatio(legs);
    if (ratio) return ratio;

    const [a, b] = legs;
    const sameExp = a.expiration === b.expiration;
    const sameType = a.type === b.type;
    const sameStrike = a.strike.eq(b.strike);
    const opposingSides = a.szi.gt(0) !== b.szi.gt(0);

    if (sameExp && sameType && !sameStrike && opposingSides) {
      return a.type === 'call' ? 'Call Vertical' : 'Put Vertical';
    }
    if (sameExp && !sameType && sameStrike && !opposingSides) {
      return a.szi.gt(0) ? 'Long Straddle' : 'Short Straddle';
    }
    if (sameExp && !sameType && !sameStrike && !opposingSides) {
      return a.szi.gt(0) ? 'Long Strangle' : 'Short Strangle';
    }
    if (!sameExp && sameType && sameStrike && opposingSides) {
      return 'Calendar';
    }
    if (!sameExp && sameType && !sameStrike && opposingSides) {
      return 'Diagonal';
    }
    return '2-leg spread';
  }
  if (legs.length === 3) {
    const butterfly = detectButterfly(legs);
    if (butterfly) return butterfly;
    return '3-leg spread';
  }
  if (legs.length === 4) {
    const iron = detectIron(legs);
    if (iron) return iron;
    // Also recognize a normalized butterfly (e.g. long 1 / short 1 / short 1 / long 1
    // where the two short legs sit at the same strike).
    const butterfly = detectButterfly(legs);
    if (butterfly) return butterfly;
    return '4-leg spread';
  }
  return `${legs.length}-leg spread`;
}

import type { Leg, OptionType } from './types.ts';

/**
 * Minimal leg shape the classifier operates on. Both UI `Leg[]` (buy/sell +
 * qty) and engine `OptionPosition[]` (signed szi) can be normalized into this
 * single shape so one pure function classifies both.
 *
 * `signedQty` is positive for long, negative for short. `strike` and
 * `expiration` are plain numbers — strike is a JS float (matching Yahoo's
 * chain output), expiration is unix seconds.
 */
export interface LegShape {
  type: OptionType;
  strike: number;
  expiration: number;
  signedQty: number;
}

/**
 * Float equality with a small tolerance. Strikes are quantized by the chain
 * source (integer dollars, half-dollars, or penny increments for SPX-style
 * products) so a 1e-6 tolerance is comfortably below any real-world gap while
 * absorbing float-repr rounding on values like 27.5.
 */
const EPS = 1e-6;
function feq(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}

export function legToShape(leg: Leg): LegShape {
  return {
    type: leg.contract.type,
    strike: leg.contract.strike,
    expiration: leg.contract.expiration,
    signedQty: leg.side === 'buy' ? leg.qty : -leg.qty,
  };
}

interface StrikeBucket {
  strike: number;
  netQty: number;
}

function bucketByStrike(shapes: LegShape[]): StrikeBucket[] {
  const buckets: StrikeBucket[] = [];
  for (const s of shapes) {
    const existing = buckets.find((b) => feq(b.strike, s.strike));
    if (existing) {
      existing.netQty += s.signedQty;
    } else {
      buckets.push({ strike: s.strike, netQty: s.signedQty });
    }
  }
  return buckets.sort((a, b) => a.strike - b.strike);
}

function allSameExpiration(shapes: LegShape[]): boolean {
  return shapes.every((s) => s.expiration === shapes[0].expiration);
}

function allSameType(shapes: LegShape[]): boolean {
  return shapes.every((s) => s.type === shapes[0].type);
}

function detectButterfly(shapes: LegShape[]): string | null {
  if (!allSameExpiration(shapes)) return null;
  if (!allSameType(shapes)) return null;
  const buckets = bucketByStrike(shapes);
  if (buckets.length !== 3) return null;
  const [low, mid, hi] = buckets;

  const lowSign = Math.sign(low.netQty);
  const midSign = Math.sign(mid.netQty);
  const hiSign = Math.sign(hi.netQty);
  if (lowSign === 0 || midSign === 0 || hiSign === 0) return null;
  if (lowSign !== hiSign) return null;
  if (midSign === lowSign) return null;

  const wingQty = Math.abs(low.netQty);
  if (!feq(Math.abs(hi.netQty), wingQty)) return null;
  if (!feq(Math.abs(mid.netQty), wingQty * 2)) return null;

  const type = shapes[0].type === 'call' ? 'Call' : 'Put';
  const direction = low.netQty > 0 ? 'Long' : 'Short';

  const lowerWidth = mid.strike - low.strike;
  const upperWidth = hi.strike - mid.strike;
  if (!feq(lowerWidth, upperWidth)) {
    return `${direction} Broken-Wing ${type} Butterfly`;
  }
  return `${direction} ${type} Butterfly`;
}

function detectIron(shapes: LegShape[]): string | null {
  if (!allSameExpiration(shapes)) return null;
  const calls = shapes.filter((s) => s.type === 'call');
  const puts = shapes.filter((s) => s.type === 'put');
  if (calls.length !== 2 || puts.length !== 2) return null;

  const callLong = calls.find((s) => s.signedQty > 0);
  const callShort = calls.find((s) => s.signedQty < 0);
  const putLong = puts.find((s) => s.signedQty > 0);
  const putShort = puts.find((s) => s.signedQty < 0);
  if (!callLong || !callShort || !putLong || !putShort) return null;

  const qty = Math.abs(callLong.signedQty);
  if (
    !feq(Math.abs(callShort.signedQty), qty) ||
    !feq(Math.abs(putLong.signedQty), qty) ||
    !feq(Math.abs(putShort.signedQty), qty)
  ) {
    return null;
  }

  const shortIron =
    putLong.strike < putShort.strike &&
    putShort.strike <= callShort.strike &&
    callShort.strike < callLong.strike;

  const callLongFlip = calls.find((s) => s.signedQty < 0);
  const callShortFlip = calls.find((s) => s.signedQty > 0);
  const putLongFlip = puts.find((s) => s.signedQty < 0);
  const putShortFlip = puts.find((s) => s.signedQty > 0);
  const longIron =
    callLongFlip &&
    callShortFlip &&
    putLongFlip &&
    putShortFlip &&
    putLongFlip.strike < putShortFlip.strike &&
    putShortFlip.strike <= callShortFlip.strike &&
    callShortFlip.strike < callLongFlip.strike;

  if (!shortIron && !longIron) return null;

  const direction = shortIron ? 'Short' : 'Long';
  const bodyPut = shortIron ? putShort : putShortFlip!;
  const bodyCall = shortIron ? callShort : callShortFlip!;
  const wingPut = shortIron ? putLong : putLongFlip!;
  const wingCall = shortIron ? callLong : callLongFlip!;

  const ironFly = feq(bodyPut.strike, bodyCall.strike);
  if (ironFly) {
    return `${direction} Iron Butterfly`;
  }

  const lowerWidth = bodyPut.strike - wingPut.strike;
  const upperWidth = wingCall.strike - bodyCall.strike;
  if (!feq(lowerWidth, upperWidth)) {
    return `${direction} Broken-Wing Iron Condor`;
  }
  return `${direction} Iron Condor`;
}

function detectRatio(shapes: LegShape[]): string | null {
  if (shapes.length !== 2) return null;
  const [a, b] = shapes;
  if (a.expiration !== b.expiration) return null;
  if (a.type !== b.type) return null;
  if (feq(a.strike, b.strike)) return null;
  const opposing = a.signedQty > 0 !== b.signedQty > 0;
  if (!opposing) return null;
  if (feq(Math.abs(a.signedQty), Math.abs(b.signedQty))) return null;

  const type = a.type === 'call' ? 'Call' : 'Put';
  const netQty = a.signedQty + b.signedQty;
  const kind = netQty > 0 ? 'Back' : 'Front';
  return `${type} Ratio ${kind}spread`;
}

/**
 * Strategy classifier over the abstract `LegShape`. Recognizes common 1-4
 * leg strategies. Pure and order-independent (multi-leg patterns bucket by
 * strike internally).
 *
 * Unrecognized shapes fall back to `${n}-leg spread`. This is the canonical
 * implementation; `detectSimpleStrategy` in the engine layer wraps this with
 * an OptionPosition → LegShape adapter.
 */
export function classifyShapes(shapes: LegShape[]): string {
  if (shapes.length === 0) return 'Empty';
  if (shapes.length === 1) {
    const s = shapes[0];
    const long = s.signedQty > 0;
    if (s.type === 'call') return long ? 'Long Call' : 'Short Call';
    return long ? 'Long Put' : 'Short Put';
  }
  if (shapes.length === 2) {
    const ratio = detectRatio(shapes);
    if (ratio) return ratio;

    const [a, b] = shapes;
    const sameExp = a.expiration === b.expiration;
    const sameType = a.type === b.type;
    const sameStrike = feq(a.strike, b.strike);
    const opposingSides = a.signedQty > 0 !== b.signedQty > 0;

    if (sameExp && sameType && !sameStrike && opposingSides) {
      return a.type === 'call' ? 'Call Vertical' : 'Put Vertical';
    }
    if (sameExp && !sameType && sameStrike && !opposingSides) {
      return a.signedQty > 0 ? 'Long Straddle' : 'Short Straddle';
    }
    if (sameExp && !sameType && !sameStrike && !opposingSides) {
      return a.signedQty > 0 ? 'Long Strangle' : 'Short Strangle';
    }
    if (!sameExp && sameType && sameStrike && opposingSides) {
      return 'Calendar';
    }
    if (!sameExp && sameType && !sameStrike && opposingSides) {
      return 'Diagonal';
    }
    return '2-leg spread';
  }
  if (shapes.length === 3) {
    const butterfly = detectButterfly(shapes);
    if (butterfly) return butterfly;
    return '3-leg spread';
  }
  if (shapes.length === 4) {
    const iron = detectIron(shapes);
    if (iron) return iron;
    const butterfly = detectButterfly(shapes);
    if (butterfly) return butterfly;
    return '4-leg spread';
  }
  return `${shapes.length}-leg spread`;
}

/**
 * Classify a UI-side `Leg[]` (chain-picker output) into a human-readable
 * strategy name. Thin wrapper over `classifyShapes` that handles the
 * buy/sell → signed-qty conversion.
 */
export function classifyLegs(legs: Leg[]): string {
  return classifyShapes(legs.map(legToShape));
}

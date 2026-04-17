import { describe, expect, it } from 'vitest';
import type { Leg, OptionContract } from '../types.ts';
import { classifyLegs, classifyShapes, legToShape, type LegShape } from '../strategy.ts';

const EXP_30D = 1_776_384_000 + 30 * 86_400;
const EXP_60D = 1_776_384_000 + 60 * 86_400;

function shape(overrides: Partial<LegShape> = {}): LegShape {
  return {
    type: 'call',
    strike: 400,
    expiration: EXP_30D,
    signedQty: 1,
    ...overrides,
  };
}

function contract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: 400,
    expiration: EXP_30D,
    bid: 5,
    ask: 5.2,
    last: 5.1,
    iv: 0.5,
    volume: 0,
    openInterest: 0,
    inTheMoney: false,
    ...overrides,
  };
}

function leg(side: 'buy' | 'sell', qty: number, contractOverrides: Partial<OptionContract> = {}): Leg {
  return { contract: contract(contractOverrides), side, qty };
}

describe('legToShape', () => {
  it('buy leg → positive signedQty', () => {
    const s = legToShape(leg('buy', 2, { strike: 100 }));
    expect(s).toEqual({
      type: 'call',
      strike: 100,
      expiration: EXP_30D,
      signedQty: 2,
    });
  });

  it('sell leg → negative signedQty', () => {
    const s = legToShape(leg('sell', 3, { type: 'put', strike: 90 }));
    expect(s).toEqual({
      type: 'put',
      strike: 90,
      expiration: EXP_30D,
      signedQty: -3,
    });
  });
});

describe('classifyShapes — 0 / 1 leg', () => {
  it('empty', () => {
    expect(classifyShapes([])).toBe('Empty');
  });

  it('long call', () => {
    expect(classifyShapes([shape({ type: 'call', signedQty: 1 })])).toBe('Long Call');
  });

  it('short call', () => {
    expect(classifyShapes([shape({ type: 'call', signedQty: -1 })])).toBe('Short Call');
  });

  it('long put', () => {
    expect(classifyShapes([shape({ type: 'put', signedQty: 1 })])).toBe('Long Put');
  });

  it('short put', () => {
    expect(classifyShapes([shape({ type: 'put', signedQty: -1 })])).toBe('Short Put');
  });
});

describe('classifyShapes — 2-leg verticals & straddles', () => {
  it('call vertical (debit call spread)', () => {
    const legs = [
      shape({ strike: 400, signedQty: 1 }),
      shape({ strike: 410, signedQty: -1 }),
    ];
    expect(classifyShapes(legs)).toBe('Call Vertical');
  });

  it('put vertical', () => {
    const legs = [
      shape({ type: 'put', strike: 400, signedQty: -1 }),
      shape({ type: 'put', strike: 390, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Put Vertical');
  });

  it('long straddle (same strike, same exp, same direction, mixed types)', () => {
    const legs = [
      shape({ type: 'call', strike: 400, signedQty: 1 }),
      shape({ type: 'put', strike: 400, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Straddle');
  });

  it('short straddle', () => {
    const legs = [
      shape({ type: 'call', strike: 400, signedQty: -1 }),
      shape({ type: 'put', strike: 400, signedQty: -1 }),
    ];
    expect(classifyShapes(legs)).toBe('Short Straddle');
  });

  it('long strangle (mixed types, different strikes, same direction)', () => {
    const legs = [
      shape({ type: 'call', strike: 410, signedQty: 1 }),
      shape({ type: 'put', strike: 390, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Strangle');
  });

  it('short strangle', () => {
    const legs = [
      shape({ type: 'call', strike: 410, signedQty: -1 }),
      shape({ type: 'put', strike: 390, signedQty: -1 }),
    ];
    expect(classifyShapes(legs)).toBe('Short Strangle');
  });

  it('calendar (same strike, same type, different exp, opposing sides)', () => {
    const legs = [
      shape({ strike: 400, signedQty: -1, expiration: EXP_30D }),
      shape({ strike: 400, signedQty: 1, expiration: EXP_60D }),
    ];
    expect(classifyShapes(legs)).toBe('Calendar');
  });

  it('diagonal (different strikes, same type, different exp, opposing sides)', () => {
    const legs = [
      shape({ strike: 400, signedQty: -1, expiration: EXP_30D }),
      shape({ strike: 410, signedQty: 1, expiration: EXP_60D }),
    ];
    expect(classifyShapes(legs)).toBe('Diagonal');
  });

  it('unrecognized 2-leg: two longs at different strikes, different types', () => {
    const legs = [
      shape({ type: 'call', strike: 410, signedQty: 1 }),
      shape({ type: 'put', strike: 390, signedQty: 1 }),
    ];
    // This is actually a long strangle — classifier catches it. Construct a
    // real no-match: mixed types + same strike + SAME side.
    expect(classifyShapes(legs)).toBe('Long Strangle');
    const unrecognized = [
      shape({ type: 'call', strike: 400, signedQty: 1 }),
      shape({ type: 'put', strike: 410, signedQty: -1 }), // opposing + diff strike + diff type
    ];
    expect(classifyShapes(unrecognized)).toBe('2-leg spread');
  });
});

describe('classifyShapes — ratio spreads', () => {
  it('call back-ratio (-1 @ 400 / +2 @ 410)', () => {
    const legs = [
      shape({ strike: 400, signedQty: -1 }),
      shape({ strike: 410, signedQty: 2 }),
    ];
    expect(classifyShapes(legs)).toBe('Call Ratio Backspread');
  });

  it('put front-ratio (+1 @ 400 / -2 @ 390)', () => {
    const legs = [
      shape({ type: 'put', strike: 400, signedQty: 1 }),
      shape({ type: 'put', strike: 390, signedQty: -2 }),
    ];
    expect(classifyShapes(legs)).toBe('Put Ratio Frontspread');
  });

  it('1x1 is a vertical, not a ratio', () => {
    const legs = [
      shape({ strike: 400, signedQty: 1 }),
      shape({ strike: 410, signedQty: -1 }),
    ];
    expect(classifyShapes(legs)).toBe('Call Vertical');
  });
});

describe('classifyShapes — butterflies', () => {
  it('long call butterfly: +1/-2/+1', () => {
    const legs = [
      shape({ strike: 400, signedQty: 1 }),
      shape({ strike: 410, signedQty: -2 }),
      shape({ strike: 420, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Call Butterfly');
  });

  it('short put butterfly: -1/+2/-1', () => {
    const legs = [
      shape({ type: 'put', strike: 390, signedQty: -1 }),
      shape({ type: 'put', strike: 400, signedQty: 2 }),
      shape({ type: 'put', strike: 410, signedQty: -1 }),
    ];
    expect(classifyShapes(legs)).toBe('Short Put Butterfly');
  });

  it('broken-wing butterfly: unequal wing widths', () => {
    const legs = [
      shape({ strike: 400, signedQty: 1 }),
      shape({ strike: 410, signedQty: -2 }),
      shape({ strike: 430, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Broken-Wing Call Butterfly');
  });

  it('butterfly order-independent', () => {
    const legs = [
      shape({ strike: 410, signedQty: -2 }),
      shape({ strike: 420, signedQty: 1 }),
      shape({ strike: 400, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Call Butterfly');
  });

  it('4-leg normalized butterfly (body as two −1 legs at same strike)', () => {
    const legs = [
      shape({ strike: 400, signedQty: 1 }),
      shape({ strike: 410, signedQty: -1 }),
      shape({ strike: 410, signedQty: -1 }),
      shape({ strike: 420, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Call Butterfly');
  });

  it('3-leg mixed types: NOT a butterfly', () => {
    const legs = [
      shape({ type: 'call', strike: 400, signedQty: 1 }),
      shape({ type: 'put', strike: 410, signedQty: -2 }),
      shape({ type: 'call', strike: 420, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('3-leg spread');
  });

  it('3-leg wrong qty ratio (1/1/1): NOT a butterfly', () => {
    const legs = [
      shape({ strike: 400, signedQty: 1 }),
      shape({ strike: 410, signedQty: -1 }),
      shape({ strike: 420, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('3-leg spread');
  });
});

describe('classifyShapes — iron condor / iron butterfly', () => {
  it('short iron condor', () => {
    const legs = [
      shape({ type: 'put', strike: 370, signedQty: 1 }),
      shape({ type: 'put', strike: 380, signedQty: -1 }),
      shape({ type: 'call', strike: 420, signedQty: -1 }),
      shape({ type: 'call', strike: 430, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Short Iron Condor');
  });

  it('short iron butterfly (same body strike on both sides)', () => {
    const legs = [
      shape({ type: 'put', strike: 390, signedQty: 1 }),
      shape({ type: 'put', strike: 400, signedQty: -1 }),
      shape({ type: 'call', strike: 400, signedQty: -1 }),
      shape({ type: 'call', strike: 410, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Short Iron Butterfly');
  });

  it('broken-wing iron condor (unequal wing widths)', () => {
    const legs = [
      shape({ type: 'put', strike: 375, signedQty: 1 }),
      shape({ type: 'put', strike: 380, signedQty: -1 }),
      shape({ type: 'call', strike: 420, signedQty: -1 }),
      shape({ type: 'call', strike: 430, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Short Broken-Wing Iron Condor');
  });

  it('long iron condor (flipped sides)', () => {
    const legs = [
      shape({ type: 'put', strike: 370, signedQty: -1 }),
      shape({ type: 'put', strike: 380, signedQty: 1 }),
      shape({ type: 'call', strike: 420, signedQty: 1 }),
      shape({ type: 'call', strike: 430, signedQty: -1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Iron Condor');
  });

  it('iron condor order-independent', () => {
    const legs = [
      shape({ type: 'call', strike: 420, signedQty: -1 }),
      shape({ type: 'put', strike: 370, signedQty: 1 }),
      shape({ type: 'call', strike: 430, signedQty: 1 }),
      shape({ type: 'put', strike: 380, signedQty: -1 }),
    ];
    expect(classifyShapes(legs)).toBe('Short Iron Condor');
  });

  it('iron condor with qty>1 scales correctly', () => {
    const legs = [
      shape({ type: 'put', strike: 370, signedQty: 2 }),
      shape({ type: 'put', strike: 380, signedQty: -2 }),
      shape({ type: 'call', strike: 420, signedQty: -2 }),
      shape({ type: 'call', strike: 430, signedQty: 2 }),
    ];
    expect(classifyShapes(legs)).toBe('Short Iron Condor');
  });

  it('iron condor with mismatched qty: NOT an iron', () => {
    const legs = [
      shape({ type: 'put', strike: 370, signedQty: 1 }),
      shape({ type: 'put', strike: 380, signedQty: -1 }),
      shape({ type: 'call', strike: 420, signedQty: -2 }),
      shape({ type: 'call', strike: 430, signedQty: 2 }),
    ];
    expect(classifyShapes(legs)).toBe('4-leg spread');
  });

  it('4 legs all calls: NOT an iron (falls through to 4-leg spread)', () => {
    const legs = [
      shape({ strike: 400, signedQty: 1 }),
      shape({ strike: 410, signedQty: -1 }),
      shape({ strike: 420, signedQty: -1 }),
      shape({ strike: 430, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('4-leg spread');
  });

  it('iron condor across different expirations: NOT recognized', () => {
    const legs = [
      shape({ type: 'put', strike: 370, signedQty: 1, expiration: EXP_30D }),
      shape({ type: 'put', strike: 380, signedQty: -1, expiration: EXP_30D }),
      shape({ type: 'call', strike: 420, signedQty: -1, expiration: EXP_60D }),
      shape({ type: 'call', strike: 430, signedQty: 1, expiration: EXP_60D }),
    ];
    expect(classifyShapes(legs)).toBe('4-leg spread');
  });

  it('inverted iron condor strike ordering: NOT recognized', () => {
    const legs = [
      shape({ type: 'put', strike: 370, signedQty: 1 }),
      shape({ type: 'put', strike: 450, signedQty: -1 }), // above call side
      shape({ type: 'call', strike: 380, signedQty: -1 }),
      shape({ type: 'call', strike: 430, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('4-leg spread');
  });
});

describe('classifyShapes — float strike tolerance', () => {
  it('fractional strike straddle (e.g. $27.50)', () => {
    const legs = [
      shape({ type: 'call', strike: 27.5, signedQty: 1 }),
      shape({ type: 'put', strike: 27.5, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Straddle');
  });

  it('equal-width butterfly with fractional strikes (25 / 27.5 / 30)', () => {
    const legs = [
      shape({ strike: 25, signedQty: 1 }),
      shape({ strike: 27.5, signedQty: -2 }),
      shape({ strike: 30, signedQty: 1 }),
    ];
    expect(classifyShapes(legs)).toBe('Long Call Butterfly');
  });
});

describe('classifyLegs — UI adapter', () => {
  it('classifies buy/sell legs like the canonical shape form', () => {
    const legs: Leg[] = [
      leg('buy', 1, { strike: 400 }),
      leg('sell', 1, { strike: 410 }),
    ];
    expect(classifyLegs(legs)).toBe('Call Vertical');
  });

  it('respects qty on each leg for ratio detection', () => {
    const legs: Leg[] = [
      leg('sell', 1, { strike: 400 }),
      leg('buy', 2, { strike: 410 }),
    ];
    expect(classifyLegs(legs)).toBe('Call Ratio Backspread');
  });

  it('single buy call → Long Call', () => {
    expect(classifyLegs([leg('buy', 1)])).toBe('Long Call');
  });

  it('single sell put → Short Put', () => {
    expect(classifyLegs([leg('sell', 2, { type: 'put' })])).toBe('Short Put');
  });

  it('empty → Empty', () => {
    expect(classifyLegs([])).toBe('Empty');
  });
});

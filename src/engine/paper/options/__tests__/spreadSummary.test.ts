import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import type { OptionChain, OptionContract } from '../../../../services/options/types.ts';
import {
  spreadEntryBasis,
  spreadCurrentMark,
  spreadUnrealizedPnl,
  spreadNetGreeks,
  spreadNetGreeksFromChain,
  spreadNearestDte,
  spreadFarthestDte,
  detectSimpleStrategy,
} from '../spreadSummary.ts';
import type { OptionPosition } from '../OptionPosition.ts';

// 30 days from a fixed reference "now" used in tests
const NOW = 1_713_345_600; // 2024-04-17 00:00 UTC — but we override via arg, not clock
const EXP_30D = NOW + 30 * 86400;
const EXP_60D = NOW + 60 * 86400;

function pos(overrides: Partial<OptionPosition> = {}): OptionPosition {
  return {
    id: 'op-1',
    spreadId: 'sp-1',
    contractSymbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: new Decimal(400),
    expiration: EXP_30D,
    szi: new Decimal(1),
    entryPx: new Decimal(5),
    marginUsed: new Decimal(0),
    openedAt: NOW,
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
    volume: 100,
    openInterest: 500,
    inTheMoney: false,
    ...overrides,
  };
}

function chain(overrides: Partial<OptionChain> = {}): OptionChain {
  return {
    underlying: 'TSLA',
    underlyingPrice: 400,
    expirations: [EXP_30D],
    strikes: [400],
    calls: [contract()],
    puts: [],
    loadedExpiration: EXP_30D,
    asOf: NOW,
    ...overrides,
  };
}

describe('spreadEntryBasis', () => {
  it('long single leg: positive (debit)', () => {
    const legs = [pos({ szi: new Decimal(1), entryPx: new Decimal(5) })];
    // 1 * 5 * 100 = 500
    expect(spreadEntryBasis(legs).toNumber()).toBe(500);
  });

  it('short single leg: negative (credit)', () => {
    const legs = [pos({ szi: new Decimal(-1), entryPx: new Decimal(5) })];
    // -1 * 5 * 100 = -500
    expect(spreadEntryBasis(legs).toNumber()).toBe(-500);
  });

  it('debit vertical: long 400C @ 6 - short 410C @ 3 = net $3 debit = 300', () => {
    const legs = [
      pos({ id: 'a', szi: new Decimal(1), strike: new Decimal(400), entryPx: new Decimal(6) }),
      pos({ id: 'b', szi: new Decimal(-1), strike: new Decimal(410), entryPx: new Decimal(3) }),
    ];
    // +1*6*100 + -1*3*100 = 600 - 300 = 300
    expect(spreadEntryBasis(legs).toNumber()).toBe(300);
  });

  it('credit vertical: short 400P @ 5 - long 390P @ 2 = net $3 credit = -300', () => {
    const legs = [
      pos({ id: 'a', type: 'put', szi: new Decimal(-1), strike: new Decimal(400), entryPx: new Decimal(5) }),
      pos({ id: 'b', type: 'put', szi: new Decimal(1), strike: new Decimal(390), entryPx: new Decimal(2) }),
    ];
    expect(spreadEntryBasis(legs).toNumber()).toBe(-300);
  });

  it('empty legs: zero', () => {
    expect(spreadEntryBasis([]).toNumber()).toBe(0);
  });
});

describe('spreadCurrentMark', () => {
  it('no chain: falls back to entryPx (zero unrealized)', () => {
    const legs = [pos({ szi: new Decimal(1), entryPx: new Decimal(5) })];
    const r = spreadCurrentMark(legs, null);
    expect(r.netMarkTotal.toNumber()).toBe(500);
    expect(r.legsPriced).toBe(0);
    expect(r.legCount).toBe(1);
  });

  it('chain with matching contract: uses live mid', () => {
    const legs = [pos({ szi: new Decimal(1), entryPx: new Decimal(5) })];
    const c = chain({ calls: [contract({ bid: 6, ask: 6.4 })] }); // mid = 6.2
    const r = spreadCurrentMark(legs, c);
    expect(r.netMarkPerShare.toNumber()).toBe(6.2);
    expect(r.netMarkTotal.toNumber()).toBe(620);
    expect(r.legsPriced).toBe(1);
  });

  it('chain mismatched underlying: falls back to entryPx', () => {
    const legs = [pos({ underlying: 'AAPL', szi: new Decimal(1), entryPx: new Decimal(5) })];
    const c = chain(); // underlying: TSLA
    const r = spreadCurrentMark(legs, c);
    expect(r.netMarkTotal.toNumber()).toBe(500);
    expect(r.legsPriced).toBe(0);
  });

  it('chain missing contract symbol: falls back to entryPx for that leg', () => {
    const legs = [pos({ contractSymbol: 'UNKNOWN', szi: new Decimal(1), entryPx: new Decimal(5) })];
    const c = chain();
    const r = spreadCurrentMark(legs, c);
    expect(r.netMarkTotal.toNumber()).toBe(500);
    expect(r.legsPriced).toBe(0);
  });

  it('short leg: signed mark flips (current = -mark × qty × 100)', () => {
    const legs = [pos({ szi: new Decimal(-1), entryPx: new Decimal(5) })];
    const c = chain({ calls: [contract({ bid: 4, ask: 4.4 })] }); // mid = 4.2
    const r = spreadCurrentMark(legs, c);
    expect(r.netMarkPerShare.toNumber()).toBe(-4.2);
    expect(r.netMarkTotal.toNumber()).toBe(-420);
  });
});

describe('spreadUnrealizedPnl', () => {
  it('no chain: zero PnL for all legs', () => {
    const legs = [pos({ szi: new Decimal(1), entryPx: new Decimal(5) })];
    expect(spreadUnrealizedPnl(legs, null).toNumber()).toBe(0);
  });

  it('long position, mark up: positive PnL', () => {
    const legs = [pos({ szi: new Decimal(1), entryPx: new Decimal(5) })];
    const c = chain({ calls: [contract({ bid: 6, ask: 6.4 })] }); // mid = 6.2
    // 1 * (6.2 - 5) * 100 = 120
    expect(spreadUnrealizedPnl(legs, c).toNumber()).toBeCloseTo(120, 6);
  });

  it('short position, mark down: positive PnL', () => {
    const legs = [pos({ szi: new Decimal(-1), entryPx: new Decimal(5) })];
    const c = chain({ calls: [contract({ bid: 3, ask: 3.4 })] }); // mid = 3.2
    // -1 * (3.2 - 5) * 100 = 180
    expect(spreadUnrealizedPnl(legs, c).toNumber()).toBeCloseTo(180, 6);
  });

  it('mixed legs, partial chain coverage: only priced legs contribute', () => {
    const legs = [
      pos({ id: 'a', szi: new Decimal(1), entryPx: new Decimal(5) }),
      pos({ id: 'b', contractSymbol: 'UNKNOWN', szi: new Decimal(1), entryPx: new Decimal(5) }),
    ];
    const c = chain({ calls: [contract({ bid: 6, ask: 6.4 })] }); // mid = 6.2
    expect(spreadUnrealizedPnl(legs, c).toNumber()).toBeCloseTo(120, 6);
  });
});

describe('spreadNetGreeks', () => {
  it('zero underlying: zero Greeks', () => {
    const legs = [pos({ szi: new Decimal(1) })];
    const g = spreadNetGreeks(legs, 0, NOW);
    expect(g.delta).toBe(0);
    expect(g.gamma).toBe(0);
  });

  it('long ATM call: positive delta (~0.5)', () => {
    const legs = [pos({ szi: new Decimal(1), strike: new Decimal(400) })];
    const g = spreadNetGreeks(legs, 400, NOW);
    expect(g.delta).toBeGreaterThan(0.4);
    expect(g.delta).toBeLessThan(0.7);
    expect(g.gamma).toBeGreaterThan(0);
  });

  it('short ATM call: negative delta', () => {
    const legs = [pos({ szi: new Decimal(-1), strike: new Decimal(400) })];
    const g = spreadNetGreeks(legs, 400, NOW);
    expect(g.delta).toBeLessThan(0);
  });

  it('vertical spread: deltas partially cancel', () => {
    const legs = [
      pos({ id: 'a', szi: new Decimal(1), strike: new Decimal(400) }),
      pos({ id: 'b', szi: new Decimal(-1), strike: new Decimal(410), contractSymbol: 'B' }),
    ];
    const g = spreadNetGreeks(legs, 400, NOW);
    // Long lower strike minus short higher strike: net delta is small but positive
    expect(g.delta).toBeGreaterThan(0);
    expect(g.delta).toBeLessThan(0.3);
  });

  it('qty scales Greeks linearly', () => {
    const one = spreadNetGreeks([pos({ szi: new Decimal(1) })], 400, NOW);
    const five = spreadNetGreeks([pos({ szi: new Decimal(5) })], 400, NOW);
    expect(five.delta).toBeCloseTo(one.delta * 5, 6);
    expect(five.gamma).toBeCloseTo(one.gamma * 5, 6);
  });
});

describe('spreadNetGreeksFromChain', () => {
  it('no chain: zero Greeks', () => {
    const legs = [pos({ szi: new Decimal(1) })];
    const g = spreadNetGreeksFromChain(legs, null, NOW);
    expect(g.delta).toBe(0);
  });

  it('chain mismatched underlying: that leg contributes nothing', () => {
    const legs = [pos({ underlying: 'AAPL', szi: new Decimal(1) })];
    const c = chain(); // TSLA
    const g = spreadNetGreeksFromChain(legs, c, NOW);
    expect(g.delta).toBe(0);
  });

  it('matching chain: uses live IV', () => {
    const legs = [pos({ szi: new Decimal(1), strike: new Decimal(400) })];
    const highIv = chain({
      calls: [contract({ iv: 1.0 })],
    });
    const lowIv = chain({
      calls: [contract({ iv: 0.2 })],
    });
    const gHi = spreadNetGreeksFromChain(legs, highIv, NOW);
    const gLo = spreadNetGreeksFromChain(legs, lowIv, NOW);
    // Higher IV at ATM spreads the probability distribution, so gamma drops.
    // Vega is non-monotonic in IV (peaks near ATM), so don't assert on it here.
    expect(gHi.gamma).toBeLessThan(gLo.gamma);
    // And option price (extrinsic value) strictly increases with IV.
    expect(gHi.price).toBeGreaterThan(gLo.price);
  });
});

describe('spreadNearestDte / spreadFarthestDte', () => {
  it('single leg 30 days out: ~30 DTE', () => {
    const legs = [pos({ expiration: EXP_30D })];
    expect(spreadNearestDte(legs, NOW)).toBe(30);
    expect(spreadFarthestDte(legs, NOW)).toBe(30);
  });

  it('calendar spread: nearest = 30, farthest = 60', () => {
    const legs = [
      pos({ id: 'a', expiration: EXP_30D }),
      pos({ id: 'b', expiration: EXP_60D }),
    ];
    expect(spreadNearestDte(legs, NOW)).toBe(30);
    expect(spreadFarthestDte(legs, NOW)).toBe(60);
  });

  it('expired leg: negative DTE', () => {
    const legs = [pos({ expiration: NOW - 2 * 86400 })];
    expect(spreadNearestDte(legs, NOW)).toBe(-2);
  });

  it('empty legs: zero', () => {
    expect(spreadNearestDte([], NOW)).toBe(0);
    expect(spreadFarthestDte([], NOW)).toBe(0);
  });
});

describe('detectSimpleStrategy', () => {
  it('single long call', () => {
    expect(detectSimpleStrategy([pos({ szi: new Decimal(1) })])).toBe('Long Call');
  });

  it('single short put', () => {
    expect(
      detectSimpleStrategy([pos({ type: 'put', szi: new Decimal(-1) })]),
    ).toBe('Short Put');
  });

  it('call vertical (same exp, same type, different strikes, opposing sides)', () => {
    const legs = [
      pos({ id: 'a', szi: new Decimal(1), strike: new Decimal(400) }),
      pos({ id: 'b', szi: new Decimal(-1), strike: new Decimal(410) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Call Vertical');
  });

  it('long straddle (same exp, same strike, different types, same direction)', () => {
    const legs = [
      pos({ id: 'a', type: 'call', szi: new Decimal(1), strike: new Decimal(400) }),
      pos({ id: 'b', type: 'put', szi: new Decimal(1), strike: new Decimal(400) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Long Straddle');
  });

  it('long strangle (same exp, different strikes, different types, same direction)', () => {
    const legs = [
      pos({ id: 'a', type: 'call', szi: new Decimal(1), strike: new Decimal(410) }),
      pos({ id: 'b', type: 'put', szi: new Decimal(1), strike: new Decimal(390) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Long Strangle');
  });

  it('calendar (different exp, same type, same strike, opposing sides)', () => {
    const legs = [
      pos({ id: 'a', szi: new Decimal(-1), expiration: EXP_30D }),
      pos({ id: 'b', szi: new Decimal(1), expiration: EXP_60D }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Calendar');
  });

  it('diagonal (different exp, same type, different strikes, opposing sides)', () => {
    const legs = [
      pos({ id: 'a', szi: new Decimal(-1), strike: new Decimal(400), expiration: EXP_30D }),
      pos({ id: 'b', szi: new Decimal(1), strike: new Decimal(410), expiration: EXP_60D }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Diagonal');
  });

  it('unrecognized 4-leg shape returns "4-leg spread"', () => {
    // Four long calls at four different strikes — not an iron, not a butterfly.
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(1) }),
      pos({ id: 'c', strike: new Decimal(420), szi: new Decimal(1) }),
      pos({ id: 'd', strike: new Decimal(430), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('4-leg spread');
  });

  it('empty: "Empty"', () => {
    expect(detectSimpleStrategy([])).toBe('Empty');
  });

  // ===== Butterflies =====

  it('long call butterfly: +1 @ 400, -2 @ 410, +1 @ 420', () => {
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(-2) }),
      pos({ id: 'c', strike: new Decimal(420), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Long Call Butterfly');
  });

  it('short put butterfly: -1 @ 390, +2 @ 400, -1 @ 410', () => {
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(390), szi: new Decimal(-1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(400), szi: new Decimal(2) }),
      pos({ id: 'c', type: 'put', strike: new Decimal(410), szi: new Decimal(-1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Short Put Butterfly');
  });

  it('broken-wing call butterfly: unequal wing widths', () => {
    // Wings at 400/410/430 — lower width 10, upper width 20
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(-2) }),
      pos({ id: 'c', strike: new Decimal(430), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Long Broken-Wing Call Butterfly');
  });

  it('butterfly order-independent (legs passed out of order)', () => {
    const legs = [
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(-2) }),
      pos({ id: 'c', strike: new Decimal(420), szi: new Decimal(1) }),
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Long Call Butterfly');
  });

  it('butterfly with 4 legs normalized (1 long + 2 × 1-short + 1 long at same body strike)', () => {
    // +1 @ 400, -1 @ 410, -1 @ 410, +1 @ 420 → bucketed: +1, -2, +1
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', contractSymbol: 'B1', strike: new Decimal(410), szi: new Decimal(-1) }),
      pos({ id: 'c', contractSymbol: 'B2', strike: new Decimal(410), szi: new Decimal(-1) }),
      pos({ id: 'd', strike: new Decimal(420), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Long Call Butterfly');
  });

  it('3-leg mixed types: NOT a butterfly', () => {
    const legs = [
      pos({ id: 'a', type: 'call', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(410), szi: new Decimal(-2) }),
      pos({ id: 'c', type: 'call', strike: new Decimal(420), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('3-leg spread');
  });

  it('3-leg wrong qty ratio (1/1/1): NOT a butterfly', () => {
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(-1) }),
      pos({ id: 'c', strike: new Decimal(420), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('3-leg spread');
  });

  it('butterfly qty=2 scales correctly: +2/-4/+2', () => {
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(2) }),
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(-4) }),
      pos({ id: 'c', strike: new Decimal(420), szi: new Decimal(2) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Long Call Butterfly');
  });

  // ===== Iron Condor / Iron Butterfly =====

  it('short iron condor: -1 put @ 380, +1 put @ 370, -1 call @ 420, +1 call @ 430', () => {
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(370), szi: new Decimal(1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(380), szi: new Decimal(-1) }),
      pos({ id: 'c', type: 'call', strike: new Decimal(420), szi: new Decimal(-1) }),
      pos({ id: 'd', type: 'call', strike: new Decimal(430), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Short Iron Condor');
  });

  it('short iron butterfly: same short strike on call and put side', () => {
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(390), szi: new Decimal(1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(400), szi: new Decimal(-1) }),
      pos({ id: 'c', type: 'call', strike: new Decimal(400), szi: new Decimal(-1) }),
      pos({ id: 'd', type: 'call', strike: new Decimal(410), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Short Iron Butterfly');
  });

  it('broken-wing iron condor: unequal wing widths (5 put side, 10 call side)', () => {
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(375), szi: new Decimal(1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(380), szi: new Decimal(-1) }),
      pos({ id: 'c', type: 'call', strike: new Decimal(420), szi: new Decimal(-1) }),
      pos({ id: 'd', type: 'call', strike: new Decimal(430), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Short Broken-Wing Iron Condor');
  });

  it('long iron condor (flipped sides): +short-wings / -long-body', () => {
    // Long iron condor: buy the body, sell the wings (rare, but valid)
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(370), szi: new Decimal(-1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(380), szi: new Decimal(1) }),
      pos({ id: 'c', type: 'call', strike: new Decimal(420), szi: new Decimal(1) }),
      pos({ id: 'd', type: 'call', strike: new Decimal(430), szi: new Decimal(-1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Long Iron Condor');
  });

  it('iron condor order-independent (legs in arbitrary order)', () => {
    const legs = [
      pos({ id: 'c', type: 'call', strike: new Decimal(420), szi: new Decimal(-1) }),
      pos({ id: 'a', type: 'put', strike: new Decimal(370), szi: new Decimal(1) }),
      pos({ id: 'd', type: 'call', strike: new Decimal(430), szi: new Decimal(1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(380), szi: new Decimal(-1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Short Iron Condor');
  });

  it('iron condor with qty>1 scales correctly (2-lot)', () => {
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(370), szi: new Decimal(2) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(380), szi: new Decimal(-2) }),
      pos({ id: 'c', type: 'call', strike: new Decimal(420), szi: new Decimal(-2) }),
      pos({ id: 'd', type: 'call', strike: new Decimal(430), szi: new Decimal(2) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Short Iron Condor');
  });

  it('4-leg mismatched qty: NOT an iron condor', () => {
    // Imbalanced qty on put vs call side
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(370), szi: new Decimal(1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(380), szi: new Decimal(-1) }),
      pos({ id: 'c', type: 'call', strike: new Decimal(420), szi: new Decimal(-2) }),
      pos({ id: 'd', type: 'call', strike: new Decimal(430), szi: new Decimal(2) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('4-leg spread');
  });

  it('4-leg all calls (double vertical shape): NOT an iron condor', () => {
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(-1) }),
      pos({ id: 'c', strike: new Decimal(420), szi: new Decimal(-1) }),
      pos({ id: 'd', strike: new Decimal(430), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('4-leg spread');
  });

  it('4-leg iron shape with invalid strike ordering: NOT an iron condor', () => {
    // Put short strike > call short strike (inverted)
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(370), szi: new Decimal(1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(450), szi: new Decimal(-1) }), // put above call side
      pos({ id: 'c', type: 'call', strike: new Decimal(380), szi: new Decimal(-1) }),
      pos({ id: 'd', type: 'call', strike: new Decimal(430), szi: new Decimal(1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('4-leg spread');
  });

  it('iron condor across different expirations: NOT recognized (needs same exp)', () => {
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(370), szi: new Decimal(1), expiration: EXP_30D }),
      pos({ id: 'b', type: 'put', strike: new Decimal(380), szi: new Decimal(-1), expiration: EXP_30D }),
      pos({ id: 'c', type: 'call', strike: new Decimal(420), szi: new Decimal(-1), expiration: EXP_60D }),
      pos({ id: 'd', type: 'call', strike: new Decimal(430), szi: new Decimal(1), expiration: EXP_60D }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('4-leg spread');
  });

  // ===== Ratio spreads =====

  it('call back-ratio (1x2): -1 @ 400, +2 @ 410 → net long', () => {
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(-1) }),
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(2) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Call Ratio Backspread');
  });

  it('put front-ratio (1x2): +1 @ 400, -2 @ 390 → net short', () => {
    const legs = [
      pos({ id: 'a', type: 'put', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', type: 'put', strike: new Decimal(390), szi: new Decimal(-2) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Put Ratio Frontspread');
  });

  it('ratio requires different abs qty (1x1 is a vertical, not a ratio)', () => {
    const legs = [
      pos({ id: 'a', strike: new Decimal(400), szi: new Decimal(1) }),
      pos({ id: 'b', strike: new Decimal(410), szi: new Decimal(-1) }),
    ];
    expect(detectSimpleStrategy(legs)).toBe('Call Vertical');
  });
});

import { describe, expect, it } from 'vitest';
import type { Leg, OptionContract } from '../types.ts';
import {
  CONTRACT_MULTIPLIER,
  legMark,
  legSignedMark,
  netGreeks,
  netPerShare,
  netTotal,
} from '../netSummary.ts';

const NOW = 1_776_384_000; // 2026-04-17 00:00 UTC — matches fixture asOf

function contract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: 400,
    expiration: NOW + 30 * 86_400, // 30 days out so Greeks are non-degenerate
    bid: 10,
    ask: 11,
    last: 10.5,
    iv: 0.5,
    volume: 0,
    openInterest: 0,
    inTheMoney: false,
    ...overrides,
  };
}

function leg(overrides: Partial<Leg> = {}, contractOverrides: Partial<OptionContract> = {}): Leg {
  return {
    contract: contract(contractOverrides),
    side: 'buy',
    qty: 1,
    ...overrides,
  };
}

describe('legMark', () => {
  it('returns mid when both bid and ask are present', () => {
    const { mark, reliable } = legMark(leg());
    expect(mark).toBe(10.5);
    expect(reliable).toBe(true);
  });

  it('falls back to bid when ask is 0', () => {
    const { mark, reliable } = legMark(leg({}, { bid: 9, ask: 0 }));
    expect(mark).toBe(9);
    expect(reliable).toBe(false);
  });

  it('falls back to ask when bid is 0', () => {
    const { mark, reliable } = legMark(leg({}, { bid: 0, ask: 12 }));
    expect(mark).toBe(12);
    expect(reliable).toBe(false);
  });

  it('falls back to last when both sides are 0', () => {
    const { mark } = legMark(leg({}, { bid: 0, ask: 0, last: 7.25 }));
    expect(mark).toBe(7.25);
  });

  it('returns 0 when nothing is usable', () => {
    const { mark } = legMark(leg({}, { bid: 0, ask: 0, last: 0 }));
    expect(mark).toBe(0);
  });
});

describe('legSignedMark', () => {
  it('is positive for a buy', () => {
    expect(legSignedMark(leg({ side: 'buy' }))).toBe(10.5);
  });

  it('is negative for a sell', () => {
    expect(legSignedMark(leg({ side: 'sell' }))).toBe(-10.5);
  });
});

describe('netPerShare', () => {
  it('is 0 for empty legs', () => {
    expect(netPerShare([])).toBe(0);
  });

  it('sums signed marks weighted by qty', () => {
    // Long 2 calls @ 10.5 + short 1 call @ 10.5 = +10.5 per share net debit.
    const longLeg = leg({ qty: 2, side: 'buy' });
    const shortLeg = leg({ qty: 1, side: 'sell' }, { symbol: 'TSLA260417C00420000', strike: 420 });
    expect(netPerShare([longLeg, shortLeg])).toBeCloseTo(10.5, 10);
  });

  it('returns negative for a net-credit spread (short premium > long premium)', () => {
    const shortHi = leg({ side: 'sell' }, { bid: 12, ask: 13 }); // mark 12.5
    const longLo = leg({ side: 'buy' }, { symbol: 'TSLA260417C00420000', strike: 420, bid: 5, ask: 6 }); // mark 5.5
    // Sold 12.5, bought 5.5 → -7 per share credit.
    expect(netPerShare([shortHi, longLo])).toBeCloseTo(-7, 10);
  });
});

describe('netTotal', () => {
  it('multiplies per-share by 100 and the qty scalar', () => {
    const l = leg({ qty: 1, side: 'buy' });
    expect(netTotal([l], 1)).toBeCloseTo(10.5 * CONTRACT_MULTIPLIER, 10);
    expect(netTotal([l], 3)).toBeCloseTo(10.5 * CONTRACT_MULTIPLIER * 3, 10);
  });

  it('defaults qty scalar to 1', () => {
    expect(netTotal([leg()])).toBe(netTotal([leg()], 1));
  });
});

describe('netGreeks', () => {
  it('returns zero greeks for empty legs', () => {
    const g = netGreeks([], 400, NOW);
    expect(g).toEqual({ price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 });
  });

  it('sums greeks with sign from side and weight from qty', () => {
    // Long 1 ATM call, short 1 ATM call at same strike → greeks cancel.
    const longCall = leg({ side: 'buy' });
    const shortCall = leg({ side: 'sell' });
    const g = netGreeks([longCall, shortCall], 400, NOW);
    expect(g.delta).toBeCloseTo(0, 10);
    expect(g.gamma).toBeCloseTo(0, 10);
    expect(g.vega).toBeCloseTo(0, 10);
  });

  it('doubles greeks when qty doubles', () => {
    const single = netGreeks([leg({ qty: 1 })], 400, NOW);
    const doubled = netGreeks([leg({ qty: 2 })], 400, NOW);
    expect(doubled.delta).toBeCloseTo(single.delta * 2, 10);
    expect(doubled.gamma).toBeCloseTo(single.gamma * 2, 10);
  });

  it('long call has positive delta, short call has negative delta', () => {
    const long = netGreeks([leg({ side: 'buy' })], 400, NOW);
    const short = netGreeks([leg({ side: 'sell' })], 400, NOW);
    expect(long.delta).toBeGreaterThan(0);
    expect(short.delta).toBeLessThan(0);
    expect(long.delta).toBeCloseTo(-short.delta, 10);
  });
});

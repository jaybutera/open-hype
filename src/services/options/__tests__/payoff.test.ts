import { describe, expect, it } from 'vitest';
import type { Leg, OptionContract } from '../types.ts';
import {
  buildPayoffCurve,
  contractIntrinsic,
  expirationPnl,
  findBreakevens,
  todayPnl,
  type PayoffSample,
} from '../payoff.ts';

const NOW = 1_776_384_000; // 2026-04-17 00:00 UTC

function contract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: 'TSLA260517C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: 400,
    expiration: NOW + 30 * 86_400,
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

describe('contractIntrinsic', () => {
  it('call ITM equals S-K', () => {
    expect(contractIntrinsic('call', 100, 120)).toBe(20);
  });
  it('call OTM is 0', () => {
    expect(contractIntrinsic('call', 100, 90)).toBe(0);
  });
  it('put ITM equals K-S', () => {
    expect(contractIntrinsic('put', 100, 80)).toBe(20);
  });
  it('put OTM is 0', () => {
    expect(contractIntrinsic('put', 100, 120)).toBe(0);
  });
  it('ATM is 0 for both types', () => {
    expect(contractIntrinsic('call', 100, 100)).toBe(0);
    expect(contractIntrinsic('put', 100, 100)).toBe(0);
  });
});

describe('expirationPnl', () => {
  it('long call at expiration at ATM = -premium × 100', () => {
    // mid = (10+11)/2 = 10.5, long 1 contract
    const pnl = expirationPnl([leg()], 400);
    expect(pnl).toBeCloseTo(-10.5 * 100, 6);
  });

  it('long call at expiration at S = K + premium breaks even', () => {
    const pnl = expirationPnl([leg()], 410.5);
    expect(pnl).toBeCloseTo(0, 6);
  });

  it('long call deep ITM yields intrinsic - premium × 100', () => {
    const pnl = expirationPnl([leg()], 500);
    // intrinsic 100 - premium 10.5 = 89.5 per share × 100
    expect(pnl).toBeCloseTo(89.5 * 100, 6);
  });

  it('short call capped gain = +premium at OTM', () => {
    const pnl = expirationPnl([leg({ side: 'sell' })], 300);
    expect(pnl).toBeCloseTo(10.5 * 100, 6);
  });

  it('short call unbounded loss deep ITM', () => {
    const pnl = expirationPnl([leg({ side: 'sell' })], 500);
    // +premium 10.5 - intrinsic 100 = -89.5 per share
    expect(pnl).toBeCloseTo(-89.5 * 100, 6);
  });

  it('long put ITM yields intrinsic - premium', () => {
    const pnl = expirationPnl([leg({}, { type: 'put', strike: 400 })], 350);
    // intrinsic 50 - premium 10.5 = 39.5
    expect(pnl).toBeCloseTo(39.5 * 100, 6);
  });

  it('vertical debit spread caps max profit at width - debit', () => {
    // Long 400 call @ 10.5, short 410 call @ 5 → debit 5.5 per share; max profit = 10 - 5.5 = 4.5
    const long = leg({}, { strike: 400, bid: 10, ask: 11 }); // mid 10.5
    const short = leg({ side: 'sell' }, { strike: 410, bid: 4, ask: 6 }); // mid 5
    const atMaxProfit = expirationPnl([long, short], 500); // deep ITM both
    expect(atMaxProfit).toBeCloseTo(4.5 * 100, 6);
  });

  it('scales linearly with qty and qtyScalar', () => {
    const base = expirationPnl([leg()], 500, 1);
    const doubleQty = expirationPnl([leg({ qty: 2 })], 500, 1);
    const doubleScalar = expirationPnl([leg()], 500, 2);
    expect(doubleQty).toBeCloseTo(base * 2, 6);
    expect(doubleScalar).toBeCloseTo(base * 2, 6);
  });

  it('empty legs yields 0 at every S', () => {
    expect(expirationPnl([], 100)).toBe(0);
    expect(expirationPnl([], 1000)).toBe(0);
  });
});

describe('todayPnl', () => {
  it('at S = entry spot with today = now, long call ~ 0 PnL (bought at mid, priced at mid)', () => {
    // This is a sanity check — BS price at the leg's own IV should roughly
    // equal the mark used as entry. Allow a small tolerance since mid isn't
    // exactly the BS price.
    const pnl = todayPnl([leg()], 400, NOW);
    // Doesn't have to be zero but should not be order-of-magnitude off.
    expect(Math.abs(pnl)).toBeLessThan(5000);
  });

  it('long call today PnL increases as S increases', () => {
    const low = todayPnl([leg()], 350, NOW);
    const mid = todayPnl([leg()], 400, NOW);
    const high = todayPnl([leg()], 500, NOW);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('short call today PnL decreases as S increases', () => {
    const low = todayPnl([leg({ side: 'sell' })], 350, NOW);
    const high = todayPnl([leg({ side: 'sell' })], 500, NOW);
    expect(low).toBeGreaterThan(high);
  });

  it('at expiration-day timestamp, today PnL converges to expiration PnL (intrinsic)', () => {
    const expirationTime = NOW + 30 * 86_400;
    const S = 450;
    const expPnl = expirationPnl([leg()], S);
    const nowPnl = todayPnl([leg()], S, expirationTime);
    expect(nowPnl).toBeCloseTo(expPnl, 4);
  });
});

describe('findBreakevens', () => {
  function sample(price: number, expiration: number): PayoffSample {
    return { price, expiration, today: 0 };
  }

  it('returns empty for all-zero samples', () => {
    expect(findBreakevens([sample(100, 0), sample(110, 0)])).toEqual([]);
  });

  it('returns empty when all samples share a sign', () => {
    expect(findBreakevens([sample(100, -10), sample(110, -5), sample(120, -1)])).toEqual([]);
  });

  it('finds single zero-crossing via interpolation', () => {
    // y goes from -10 @ 100 to +10 @ 120 → crossing at 110
    const xs = findBreakevens([sample(100, -10), sample(120, 10)]);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(110, 6);
  });

  it('finds two crossings for a bell-shaped payoff', () => {
    // Synthetic profile: negative → positive → negative
    const xs = findBreakevens([
      sample(100, -10),
      sample(110, 10),
      sample(120, 10),
      sample(130, -10),
    ]);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(105, 6);
    expect(xs[1]).toBeCloseTo(125, 6);
  });

  it('treats an exact-zero sample as a crossing', () => {
    const xs = findBreakevens([sample(100, -1), sample(110, 0), sample(120, 1)]);
    // Will register 110 from the first segment's endpoint
    expect(xs.length).toBeGreaterThanOrEqual(1);
    expect(xs[0]).toBeCloseTo(110, 6);
  });
});

describe('buildPayoffCurve', () => {
  it('produces the requested number of samples', () => {
    const c = buildPayoffCurve([leg()], 400, { samples: 50, nowSec: NOW });
    expect(c.samples).toHaveLength(50);
  });

  it('default range spans ±30% around center', () => {
    const c = buildPayoffCurve([leg()], 400, { nowSec: NOW });
    expect(c.xMin).toBeCloseTo(400 * 0.7, 6);
    expect(c.xMax).toBeCloseTo(400 * 1.3, 6);
  });

  it('custom rangePct is honored', () => {
    const c = buildPayoffCurve([leg()], 400, { rangePct: 0.5, nowSec: NOW });
    expect(c.xMin).toBeCloseTo(200, 6);
    expect(c.xMax).toBeCloseTo(600, 6);
  });

  it('xMin clamps at 0 for volatile / low-priced underlyings', () => {
    const c = buildPayoffCurve([leg()], 3, { rangePct: 2, nowSec: NOW });
    expect(c.xMin).toBe(0);
  });

  it('samples cover both P&L series and yMin/yMax bound them', () => {
    const c = buildPayoffCurve([leg()], 400, { samples: 21, nowSec: NOW });
    for (const s of c.samples) {
      expect(s.expiration).toBeGreaterThanOrEqual(c.yMin);
      expect(s.expiration).toBeLessThanOrEqual(c.yMax);
      expect(s.today).toBeGreaterThanOrEqual(c.yMin);
      expect(s.today).toBeLessThanOrEqual(c.yMax);
    }
  });

  it('long call curve has exactly one breakeven = strike + premium', () => {
    const c = buildPayoffCurve([leg()], 400, { samples: 201, nowSec: NOW });
    expect(c.breakevens).toHaveLength(1);
    expect(c.breakevens[0]).toBeCloseTo(410.5, 1);
  });

  it('long straddle has two breakevens symmetric around strike', () => {
    const call = leg({}, { strike: 400, bid: 10, ask: 11 }); // mid 10.5
    const put = leg({}, { type: 'put', strike: 400, bid: 10, ask: 11, symbol: 'TSLA260517P00400000' }); // mid 10.5
    const c = buildPayoffCurve([call, put], 400, { samples: 201, rangePct: 0.3, nowSec: NOW });
    expect(c.breakevens.length).toBe(2);
    // expected breakevens: 400 ± 21 (sum of premiums)
    expect(c.breakevens[0]).toBeCloseTo(400 - 21, 1);
    expect(c.breakevens[1]).toBeCloseTo(400 + 21, 1);
  });

  it('handles empty legs: constant zero P&L, no breakevens', () => {
    const c = buildPayoffCurve([], 400, { samples: 21, nowSec: NOW });
    expect(c.samples.every((s) => s.expiration === 0 && s.today === 0)).toBe(true);
    expect(c.breakevens).toEqual([]);
    expect(c.yMin).toBe(0);
    expect(c.yMax).toBe(0);
  });

  it('qtyScalar scales yMin/yMax linearly', () => {
    const c1 = buildPayoffCurve([leg()], 400, { qtyScalar: 1, samples: 21, nowSec: NOW });
    const c3 = buildPayoffCurve([leg()], 400, { qtyScalar: 3, samples: 21, nowSec: NOW });
    expect(c3.yMin).toBeCloseTo(c1.yMin * 3, 4);
    expect(c3.yMax).toBeCloseTo(c1.yMax * 3, 4);
  });
});

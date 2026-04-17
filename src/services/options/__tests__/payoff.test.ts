import { describe, expect, it } from 'vitest';
import type { Leg, OptionContract } from '../types.ts';
import {
  analyticalBreakevens,
  buildPayoffCurve,
  contractIntrinsic,
  expirationExtrema,
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

describe('expirationExtrema', () => {
  it('empty legs → both extrema zero and bounded', () => {
    const e = expirationExtrema([]);
    expect(e.maxProfit.value).toBe(0);
    expect(e.maxProfit.bounded).toBe(true);
    expect(e.maxLoss.value).toBe(0);
    expect(e.maxLoss.bounded).toBe(true);
  });

  it('long call: loss bounded at -premium, profit unbounded', () => {
    const e = expirationExtrema([leg()]); // mid 10.5 at K=400
    expect(e.maxLoss.bounded).toBe(true);
    expect(e.maxLoss.value).toBeCloseTo(-10.5 * 100, 4);
    expect(e.maxLoss.atPrice).toBeLessThanOrEqual(400);
    expect(e.maxProfit.bounded).toBe(false);
  });

  it('short call: profit bounded at +premium, loss unbounded', () => {
    const e = expirationExtrema([leg({ side: 'sell' })]);
    expect(e.maxProfit.bounded).toBe(true);
    expect(e.maxProfit.value).toBeCloseTo(10.5 * 100, 4);
    expect(e.maxLoss.bounded).toBe(false);
  });

  it('long put: profit bounded at strike, loss bounded at -premium', () => {
    const e = expirationExtrema([leg({}, { type: 'put', strike: 400 })]);
    expect(e.maxProfit.bounded).toBe(true);
    // At S=0, intrinsic = 400, premium = 10.5, so profit = 389.5 per share × 100
    expect(e.maxProfit.value).toBeCloseTo(389.5 * 100, 4);
    expect(e.maxProfit.atPrice).toBe(0);
    expect(e.maxLoss.bounded).toBe(true);
    expect(e.maxLoss.value).toBeCloseTo(-10.5 * 100, 4);
  });

  it('short put: profit bounded at +premium, loss bounded (ends at S=0)', () => {
    const e = expirationExtrema([leg({ side: 'sell' }, { type: 'put', strike: 400 })]);
    expect(e.maxProfit.bounded).toBe(true);
    expect(e.maxProfit.value).toBeCloseTo(10.5 * 100, 4);
    expect(e.maxLoss.bounded).toBe(true);
    expect(e.maxLoss.value).toBeCloseTo(-389.5 * 100, 4);
    expect(e.maxLoss.atPrice).toBe(0);
  });

  it('long call vertical debit spread: both sides bounded', () => {
    // Long 400C @ 10.5, short 410C @ 5 — debit 5.5, width 10, max profit 4.5
    const long = leg({}, { strike: 400, bid: 10, ask: 11 });
    const short = leg({ side: 'sell' }, { strike: 410, bid: 4, ask: 6 });
    const e = expirationExtrema([long, short]);
    expect(e.maxProfit.bounded).toBe(true);
    expect(e.maxProfit.value).toBeCloseTo(4.5 * 100, 4);
    expect(e.maxLoss.bounded).toBe(true);
    expect(e.maxLoss.value).toBeCloseTo(-5.5 * 100, 4);
  });

  it('iron condor: both sides bounded (defined risk, defined reward)', () => {
    // Short put 390 @ 3, long put 380 @ 1, short call 420 @ 3, long call 430 @ 1
    // Net credit per share = 3 - 1 + 3 - 1 = 4
    // Max profit = 4 × 100 = $400 (between 390 and 420)
    // Max loss = (width=10) - credit=4 = 6 per share = -$600 (below 380 or above 430)
    const shortPut = leg(
      { side: 'sell' },
      { type: 'put', strike: 390, bid: 2.5, ask: 3.5, symbol: 'X:P390' },
    );
    const longPut = leg(
      { side: 'buy' },
      { type: 'put', strike: 380, bid: 0.5, ask: 1.5, symbol: 'X:P380' },
    );
    const shortCall = leg(
      { side: 'sell' },
      { type: 'call', strike: 420, bid: 2.5, ask: 3.5, symbol: 'X:C420' },
    );
    const longCall = leg(
      { side: 'buy' },
      { type: 'call', strike: 430, bid: 0.5, ask: 1.5, symbol: 'X:C430' },
    );
    const e = expirationExtrema([shortPut, longPut, shortCall, longCall]);
    expect(e.maxProfit.bounded).toBe(true);
    expect(e.maxProfit.value).toBeCloseTo(4 * 100, 4);
    expect(e.maxLoss.bounded).toBe(true);
    expect(e.maxLoss.value).toBeCloseTo(-6 * 100, 4);
  });

  it('long straddle: loss bounded at -total premium, profit unbounded on both sides', () => {
    const call = leg({}, { type: 'call', strike: 400, bid: 10, ask: 11, symbol: 'X:C' }); // mid 10.5
    const put = leg({}, { type: 'put', strike: 400, bid: 9, ask: 10, symbol: 'X:P' }); // mid 9.5
    const e = expirationExtrema([call, put]);
    expect(e.maxProfit.bounded).toBe(false); // unbounded on the call side
    expect(e.maxLoss.bounded).toBe(true);
    expect(e.maxLoss.value).toBeCloseTo(-(10.5 + 9.5) * 100, 4);
    expect(e.maxLoss.atPrice).toBe(400);
  });

  it('scales linearly with qtyScalar', () => {
    const e1 = expirationExtrema([leg()], 1);
    const e2 = expirationExtrema([leg()], 2);
    expect(e2.maxLoss.value).toBeCloseTo(e1.maxLoss.value * 2, 4);
  });

  it('short straddle: profit bounded at +total premium, loss unbounded', () => {
    const call = leg({ side: 'sell' }, { type: 'call', strike: 400, bid: 10, ask: 11, symbol: 'X:C' });
    const put = leg({ side: 'sell' }, { type: 'put', strike: 400, bid: 9, ask: 10, symbol: 'X:P' });
    const e = expirationExtrema([call, put]);
    expect(e.maxProfit.bounded).toBe(true);
    expect(e.maxProfit.value).toBeCloseTo((10.5 + 9.5) * 100, 4);
    expect(e.maxLoss.bounded).toBe(false);
  });

  it('naked short call has unbounded loss, extremum at far right probe', () => {
    const e = expirationExtrema([leg({ side: 'sell' })]);
    expect(e.maxLoss.bounded).toBe(false);
    // The reported atPrice should be the far-right probe (2*K+1 = 801)
    expect(e.maxLoss.atPrice).toBeGreaterThan(400);
  });

  it('empty legs: zones collapse to a single point at 0', () => {
    const e = expirationExtrema([]);
    expect(e.maxProfit.zone).toEqual({ min: 0, max: 0 });
    expect(e.maxLoss.zone).toEqual({ min: 0, max: 0 });
  });

  it('long call: loss zone spans S=0 through the strike (payoff flat at -premium while OTM)', () => {
    // Call is worthless for S ≤ strike, so the max-loss band is [0, K].
    const e = expirationExtrema([leg()]);
    expect(e.maxLoss.zone.min).toBe(0);
    expect(e.maxLoss.zone.max).toBe(400);
    // Profit side is unbounded — zone collapses to atPrice
    expect(e.maxProfit.zone.min).toBe(e.maxProfit.atPrice);
    expect(e.maxProfit.zone.max).toBe(e.maxProfit.atPrice);
  });

  it('long put: profit zone single-point at S=0, loss zone spans strike through right tail', () => {
    // Put is worthless for S ≥ strike, so max loss (premium paid) is flat on that whole range.
    const e = expirationExtrema([leg({}, { type: 'put', strike: 400 })]);
    expect(e.maxProfit.zone).toEqual({ min: 0, max: 0 });
    expect(e.maxLoss.zone.min).toBe(400);
    expect(e.maxLoss.zone.max).toBeGreaterThanOrEqual(400 * 2 + 1);
  });

  it('call vertical debit spread: profit zone extends above the short strike', () => {
    // Long 400C @ 10.5, short 410C @ 5 — above 410 payoff is flat at max profit
    const long = leg({}, { strike: 400, bid: 10, ask: 11 });
    const short = leg({ side: 'sell' }, { strike: 410, bid: 4, ask: 6 });
    const e = expirationExtrema([long, short]);
    // Zone starts at the upper strike and extends to the right probe
    expect(e.maxProfit.zone.min).toBe(410);
    expect(e.maxProfit.zone.max).toBeGreaterThanOrEqual(410 * 2 + 1);
    // Loss zone starts at S=0 and extends through the lower strike
    expect(e.maxLoss.zone.min).toBe(0);
    expect(e.maxLoss.zone.max).toBe(400);
  });

  it('iron condor: profit zone is the flat band between short strikes', () => {
    const shortPut = leg(
      { side: 'sell' },
      { type: 'put', strike: 390, bid: 2.5, ask: 3.5, symbol: 'X:P390' },
    );
    const longPut = leg(
      { side: 'buy' },
      { type: 'put', strike: 380, bid: 0.5, ask: 1.5, symbol: 'X:P380' },
    );
    const shortCall = leg(
      { side: 'sell' },
      { type: 'call', strike: 420, bid: 2.5, ask: 3.5, symbol: 'X:C420' },
    );
    const longCall = leg(
      { side: 'buy' },
      { type: 'call', strike: 430, bid: 0.5, ask: 1.5, symbol: 'X:C430' },
    );
    const e = expirationExtrema([shortPut, longPut, shortCall, longCall]);
    // Max profit is flat between 390 and 420 (the short strikes)
    expect(e.maxProfit.zone.min).toBe(390);
    expect(e.maxProfit.zone.max).toBe(420);
  });

  it('long straddle: profit zone collapses (unbounded), loss zone single-point at strike', () => {
    const call = leg({}, { type: 'call', strike: 400, bid: 10, ask: 11, symbol: 'X:C' });
    const put = leg({}, { type: 'put', strike: 400, bid: 9, ask: 10, symbol: 'X:P' });
    const e = expirationExtrema([call, put]);
    // Unbounded profit — zone pinned to atPrice
    expect(e.maxProfit.zone.min).toBe(e.maxProfit.atPrice);
    expect(e.maxProfit.zone.max).toBe(e.maxProfit.atPrice);
    // Loss at the strike (single point)
    expect(e.maxLoss.zone).toEqual({ min: 400, max: 400 });
  });

  it('short strangle: profit zone is the flat band between short strikes', () => {
    const shortCall = leg(
      { side: 'sell' },
      { type: 'call', strike: 420, bid: 2.5, ask: 3.5, symbol: 'X:C420' },
    );
    const shortPut = leg(
      { side: 'sell' },
      { type: 'put', strike: 380, bid: 2.5, ask: 3.5, symbol: 'X:P380' },
    );
    const e = expirationExtrema([shortCall, shortPut]);
    // Profit is flat between the two short strikes = max premium collected
    expect(e.maxProfit.zone.min).toBe(380);
    expect(e.maxProfit.zone.max).toBe(420);
    // Loss is unbounded
    expect(e.maxLoss.bounded).toBe(false);
  });
});

describe('analyticalBreakevens', () => {
  it('empty legs → no breakevens', () => {
    expect(analyticalBreakevens([])).toEqual([]);
  });

  it('long call: single breakeven at strike + premium', () => {
    // K=400, mid 10.5 → BE 410.5
    const xs = analyticalBreakevens([leg()]);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(410.5, 9);
  });

  it('short call: single breakeven at strike + premium (mirror of long)', () => {
    const xs = analyticalBreakevens([leg({ side: 'sell' })]);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(410.5, 9);
  });

  it('long put: single breakeven at strike − premium', () => {
    // K=400, mid 10.5 → BE 389.5
    const xs = analyticalBreakevens([leg({}, { type: 'put', bid: 10, ask: 11 })]);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(389.5, 9);
  });

  it('long straddle: two symmetric breakevens at strike ± total premium', () => {
    const call = leg({}, { strike: 400, bid: 10, ask: 11 }); // mid 10.5
    const put = leg({}, { type: 'put', strike: 400, bid: 10, ask: 11, symbol: 'TSLA260517P00400000' }); // mid 10.5
    const xs = analyticalBreakevens([call, put]);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(400 - 21, 9);
    expect(xs[1]).toBeCloseTo(400 + 21, 9);
  });

  it('call vertical debit spread: single breakeven = lower strike + net debit', () => {
    // Long 400 call @ mid 10.5, short 410 call @ mid 5.5 → net debit 5 → BE = 405
    const longCall = leg({}, { strike: 400, bid: 10, ask: 11 });
    const shortCall = leg(
      { side: 'sell' },
      { strike: 410, bid: 5, ask: 6, symbol: 'TSLA260517C00410000' },
    );
    const xs = analyticalBreakevens([longCall, shortCall]);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(405, 9);
  });

  it('iron condor: two breakevens = short put − credit and short call + credit', () => {
    // Short 395 put / long 385 put / short 405 call / long 415 call
    // Premiums: 395P mid 6, 385P mid 2, 405C mid 6, 385P mid 2
    // Net credit per share = (6 - 2) + (6 - 2) = 8 → BEs at 395-8=387 and 405+8=413
    const shortPut = leg(
      { side: 'sell' },
      { type: 'put', strike: 395, bid: 5.9, ask: 6.1, symbol: 'TSLA260517P00395000' },
    );
    const longPut = leg(
      {},
      { type: 'put', strike: 385, bid: 1.9, ask: 2.1, symbol: 'TSLA260517P00385000' },
    );
    const shortCall = leg(
      { side: 'sell' },
      { strike: 405, bid: 5.9, ask: 6.1, symbol: 'TSLA260517C00405000' },
    );
    const longCall = leg(
      {},
      { strike: 415, bid: 1.9, ask: 2.1, symbol: 'TSLA260517C00415000' },
    );
    const xs = analyticalBreakevens([shortPut, longPut, shortCall, longCall]);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(387, 9);
    expect(xs[1]).toBeCloseTo(413, 9);
  });

  it('is order-independent with respect to leg ordering', () => {
    const a = leg({}, { strike: 400, bid: 10, ask: 11 });
    const b = leg({}, { type: 'put', strike: 400, bid: 10, ask: 11, symbol: 'TSLA260517P00400000' });
    const xs1 = analyticalBreakevens([a, b]);
    const xs2 = analyticalBreakevens([b, a]);
    expect(xs1).toEqual(xs2);
  });

  it('returns empty when payoff never crosses zero (naked long, far OTM and dirt cheap)', () => {
    // Short call collected 10.5 premium: payoff positive near S=0, always positive until S = K + premium
    // Shift K far right so the breakeven falls outside probe range? No — probe is 2*K+1 which always exceeds K+premium.
    // Instead: a flat net-zero payoff (e.g. long+short same contract) → no crossings
    // Use two identical contracts with opposing sides at same strike
    const long = leg({}, { strike: 400, bid: 10, ask: 11 });
    const short = leg(
      { side: 'sell' },
      { strike: 400, bid: 10, ask: 11 },
    );
    const xs = analyticalBreakevens([long, short]);
    // Payoff identically zero — no sign crossings.
    expect(xs).toEqual([]);
  });

  it('more precise than 121-sample interpolation', () => {
    // Vertical with non-round breakeven
    const longCall = leg({}, { strike: 400, bid: 10.17, ask: 10.17 });
    const shortCall = leg(
      { side: 'sell' },
      { strike: 410, bid: 3.83, ask: 3.83, symbol: 'TSLA260517C00410000' },
    );
    // Net debit = 10.17 - 3.83 = 6.34 → BE = 406.34
    const analytical = analyticalBreakevens([longCall, shortCall]);
    expect(analytical).toHaveLength(1);
    expect(analytical[0]).toBeCloseTo(406.34, 9);

    const sampled = buildPayoffCurve([longCall, shortCall], 405, {
      samples: 121,
      nowSec: NOW,
    }).breakevens;
    expect(sampled).toHaveLength(1);
    // Sampled should be within ~$1 of true; analytical is within 1e-9
    expect(Math.abs(analytical[0] - 406.34)).toBeLessThan(1e-6);
    expect(Math.abs(sampled[0] - 406.34)).toBeLessThan(2);
  });

  it('qty scaling does not move breakeven prices', () => {
    const longCall = leg({ qty: 3 }, { strike: 400, bid: 10, ask: 11 });
    const shortCall = leg(
      { side: 'sell', qty: 3 },
      { strike: 410, bid: 5, ask: 6, symbol: 'TSLA260517C00410000' },
    );
    const xs = analyticalBreakevens([longCall, shortCall]);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(405, 9);
  });
});

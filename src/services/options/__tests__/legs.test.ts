import { describe, it, expect } from 'vitest';
import { findLegIndex, hasLeg, legKey, MAX_LEGS, toggleLeg } from '../legs.ts';
import type { Leg, OptionContract } from '../types.ts';

function contract(partial: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: 'TSLA260417C00300000',
    underlying: 'TSLA',
    type: 'call',
    strike: 300,
    expiration: 1_776_384_000,
    bid: 10,
    ask: 10.5,
    last: 10.2,
    iv: 0.4,
    volume: 0,
    openInterest: 0,
    inTheMoney: false,
    ...partial,
  };
}

describe('legKey', () => {
  it('encodes contract symbol + side', () => {
    const c = contract({ symbol: 'AAA' });
    expect(legKey(c, 'buy')).toBe('AAA:buy');
    expect(legKey(c, 'sell')).toBe('AAA:sell');
  });
});

describe('findLegIndex / hasLeg', () => {
  it('finds by symbol+side', () => {
    const c = contract({ symbol: 'AAA' });
    const legs: Leg[] = [{ contract: c, side: 'buy', qty: 1 }];
    expect(findLegIndex(legs, c, 'buy')).toBe(0);
    expect(findLegIndex(legs, c, 'sell')).toBe(-1);
    expect(hasLeg(legs, c, 'buy')).toBe(true);
    expect(hasLeg(legs, c, 'sell')).toBe(false);
  });

  it('treats different symbols as distinct', () => {
    const c1 = contract({ symbol: 'AAA' });
    const c2 = contract({ symbol: 'BBB' });
    const legs: Leg[] = [{ contract: c1, side: 'buy', qty: 1 }];
    expect(hasLeg(legs, c2, 'buy')).toBe(false);
  });
});

describe('toggleLeg', () => {
  it('appends a new leg when the contract is not present', () => {
    const c = contract({ symbol: 'AAA' });
    const out = toggleLeg([], c, 'buy');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ contract: c, side: 'buy', qty: 1 });
  });

  it('removes the leg when the same contract+side is clicked again', () => {
    const c = contract({ symbol: 'AAA' });
    const start: Leg[] = [{ contract: c, side: 'buy', qty: 2 }];
    const out = toggleLeg(start, c, 'buy');
    expect(out).toEqual([]);
  });

  it('flips side when the opposite side of the same contract is clicked', () => {
    const c = contract({ symbol: 'AAA' });
    const start: Leg[] = [{ contract: c, side: 'buy', qty: 3 }];
    const out = toggleLeg(start, c, 'sell');
    expect(out).toHaveLength(1);
    expect(out[0].side).toBe('sell');
    expect(out[0].qty).toBe(3);
    expect(out[0].contract).toBe(c);
  });

  it('appends a second leg for a different contract', () => {
    const c1 = contract({ symbol: 'AAA' });
    const c2 = contract({ symbol: 'BBB' });
    const start: Leg[] = [{ contract: c1, side: 'buy', qty: 1 }];
    const out = toggleLeg(start, c2, 'sell');
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ contract: c2, side: 'sell', qty: 1 });
  });

  it('refuses to exceed MAX_LEGS', () => {
    const legs: Leg[] = Array.from({ length: MAX_LEGS }, (_, i) => ({
      contract: contract({ symbol: `S${i}` }),
      side: 'buy',
      qty: 1,
    }));
    const extra = contract({ symbol: 'OVER' });
    const out = toggleLeg(legs, extra, 'buy');
    expect(out).toHaveLength(MAX_LEGS);
    expect(out).toBe(legs); // same reference — no change
  });

  it('still allows removal even when at the cap', () => {
    const legs: Leg[] = Array.from({ length: MAX_LEGS }, (_, i) => ({
      contract: contract({ symbol: `S${i}` }),
      side: 'buy',
      qty: 1,
    }));
    const out = toggleLeg(legs, legs[0].contract, 'buy');
    expect(out).toHaveLength(MAX_LEGS - 1);
  });

  it('still allows side-flip even when at the cap', () => {
    const legs: Leg[] = Array.from({ length: MAX_LEGS }, (_, i) => ({
      contract: contract({ symbol: `S${i}` }),
      side: 'buy',
      qty: 1,
    }));
    const out = toggleLeg(legs, legs[0].contract, 'sell');
    expect(out).toHaveLength(MAX_LEGS);
    expect(out[0].side).toBe('sell');
  });

  it('is immutable — does not mutate input', () => {
    const c = contract({ symbol: 'AAA' });
    const start: Leg[] = [{ contract: c, side: 'buy', qty: 1 }];
    const snapshot = JSON.parse(JSON.stringify(start));
    toggleLeg(start, c, 'sell');
    toggleLeg(start, contract({ symbol: 'BBB' }), 'buy');
    expect(start).toEqual(snapshot);
  });
});

import { describe, it, expect } from 'vitest';
import { legFillPrice } from '../pricing.ts';
import type { OptionContract } from '../../../../services/options/types.ts';

function mkContract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: 400,
    expiration: 1776384000,
    bid: 4,
    ask: 6,
    last: 5,
    iv: 0.5,
    volume: 100,
    openInterest: 200,
    inTheMoney: false,
    ...overrides,
  };
}

describe('legFillPrice — mid model', () => {
  it('both sides populated → average', () => {
    const r = legFillPrice(mkContract({ bid: 4, ask: 6 }), 'buy', 'mid');
    expect(r.price).toBe(5);
    expect(r.reliable).toBe(true);
  });

  it('only bid → use bid, not reliable', () => {
    const r = legFillPrice(mkContract({ bid: 3, ask: 0 }), 'buy', 'mid');
    expect(r.price).toBe(3);
    expect(r.reliable).toBe(false);
  });

  it('only ask → use ask, not reliable', () => {
    const r = legFillPrice(mkContract({ bid: 0, ask: 7 }), 'sell', 'mid');
    expect(r.price).toBe(7);
    expect(r.reliable).toBe(false);
  });

  it('no bid/ask → fall back to last', () => {
    const r = legFillPrice(mkContract({ bid: 0, ask: 0, last: 2 }), 'buy', 'mid');
    expect(r.price).toBe(2);
    expect(r.reliable).toBe(false);
  });

  it('nothing usable → zero', () => {
    const r = legFillPrice(mkContract({ bid: 0, ask: 0, last: 0 }), 'buy', 'mid');
    expect(r.price).toBe(0);
    expect(r.reliable).toBe(false);
  });
});

describe('legFillPrice — cross model', () => {
  it('buy pays ask', () => {
    const r = legFillPrice(mkContract({ bid: 4, ask: 6 }), 'buy', 'cross');
    expect(r.price).toBe(6);
    expect(r.reliable).toBe(true);
  });

  it('sell hits bid', () => {
    const r = legFillPrice(mkContract({ bid: 4, ask: 6 }), 'sell', 'cross');
    expect(r.price).toBe(4);
    expect(r.reliable).toBe(true);
  });

  it('buy falls back to mid when ask is 0', () => {
    const r = legFillPrice(mkContract({ bid: 4, ask: 0 }), 'buy', 'cross');
    expect(r.price).toBe(4);
    expect(r.reliable).toBe(false);
  });

  it('sell falls back to mid when bid is 0', () => {
    const r = legFillPrice(mkContract({ bid: 0, ask: 6 }), 'sell', 'cross');
    expect(r.price).toBe(6);
    expect(r.reliable).toBe(false);
  });

  it('cross marks reliable=false when opposite side is 0 (one-sided book)', () => {
    const r = legFillPrice(mkContract({ bid: 0, ask: 6 }), 'buy', 'cross');
    expect(r.price).toBe(6);
    expect(r.reliable).toBe(false);
  });
});

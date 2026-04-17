import { describe, it, expect } from 'vitest';
import { buildStrikeRows } from '../ChainGrid.tsx';
import type { OptionChain, OptionContract } from '../../../services/options/types.ts';

function contract(partial: Partial<OptionContract>): OptionContract {
  return {
    symbol: 'TEST',
    underlying: 'TEST',
    type: 'call',
    strike: 100,
    expiration: 0,
    bid: 1,
    ask: 1.1,
    last: 1.05,
    iv: 0.3,
    volume: 0,
    openInterest: 0,
    inTheMoney: false,
    ...partial,
  };
}

function chain(calls: OptionContract[], puts: OptionContract[]): OptionChain {
  return {
    underlying: 'TEST',
    underlyingPrice: 100,
    expirations: [0],
    strikes: [],
    calls,
    puts,
    loadedExpiration: 0,
    asOf: 0,
  };
}

describe('buildStrikeRows', () => {
  it('pairs calls and puts at the same strike', () => {
    const c = chain(
      [contract({ type: 'call', strike: 100 })],
      [contract({ type: 'put', strike: 100 })],
    );
    const rows = buildStrikeRows(c);
    expect(rows).toHaveLength(1);
    expect(rows[0].strike).toBe(100);
    expect(rows[0].call?.type).toBe('call');
    expect(rows[0].put?.type).toBe('put');
  });

  it('includes strikes with only a call or only a put', () => {
    const c = chain(
      [contract({ type: 'call', strike: 90 })],
      [contract({ type: 'put', strike: 110 })],
    );
    const rows = buildStrikeRows(c);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ strike: 90, call: expect.any(Object) });
    expect(rows[1]).toEqual({ strike: 110, put: expect.any(Object) });
  });

  it('sorts by strike ascending', () => {
    const c = chain(
      [
        contract({ type: 'call', strike: 110 }),
        contract({ type: 'call', strike: 90 }),
        contract({ type: 'call', strike: 100 }),
      ],
      [],
    );
    const rows = buildStrikeRows(c);
    expect(rows.map((r) => r.strike)).toEqual([90, 100, 110]);
  });

  it('returns empty when chain has no calls or puts', () => {
    const c = chain([], []);
    expect(buildStrikeRows(c)).toEqual([]);
  });

  it('deduplicates when calls and puts both have the same strike', () => {
    const c = chain(
      [contract({ type: 'call', strike: 50 }), contract({ type: 'call', strike: 60 })],
      [contract({ type: 'put', strike: 50 }), contract({ type: 'put', strike: 70 })],
    );
    const rows = buildStrikeRows(c);
    expect(rows.map((r) => r.strike)).toEqual([50, 60, 70]);
    expect(rows[0].call && rows[0].put).toBeTruthy();
    expect(rows[1].call).toBeTruthy();
    expect(rows[1].put).toBeUndefined();
    expect(rows[2].put).toBeTruthy();
    expect(rows[2].call).toBeUndefined();
  });
});

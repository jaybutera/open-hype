import { describe, it, expect } from 'vitest';
import { aggregate1m, bucketStart, mergeIntoInterval } from '../aggregate.ts';
import type { CandleData } from '../../../types/market.ts';

const MIN = 60_000;

function c1m(t: number, o: number, h: number, l: number, c: number, v = 1): CandleData {
  return {
    t, T: t + MIN - 1, s: 'BTC', i: '1m',
    o: String(o), h: String(h), l: String(l), c: String(c), v: String(v), n: 1,
  };
}

describe('bucketStart', () => {
  it('aligns to UTC interval boundaries', () => {
    // 2026-03-16T00:07:00Z into 5m bucket -> 00:05
    const t = Date.UTC(2026, 2, 16, 0, 7);
    expect(bucketStart(t, 5 * MIN)).toBe(Date.UTC(2026, 2, 16, 0, 5));
    expect(bucketStart(t, 86_400_000)).toBe(Date.UTC(2026, 2, 16));
  });
});

describe('aggregate1m', () => {
  const base = Date.UTC(2026, 2, 16, 12, 0);
  const oneMin = [
    c1m(base + 0 * MIN, 100, 105, 99, 104),
    c1m(base + 1 * MIN, 104, 110, 103, 108),
    c1m(base + 2 * MIN, 108, 109, 101, 102),
    c1m(base + 3 * MIN, 102, 103, 100, 101),
    c1m(base + 4 * MIN, 101, 106, 101, 105),
    c1m(base + 5 * MIN, 105, 107, 104, 106), // next 5m bucket
  ];

  it('returns copies for 1m', () => {
    const out = aggregate1m(oneMin, '1m');
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual(oneMin[0]);
    expect(out[0]).not.toBe(oneMin[0]);
  });

  it('aggregates OHLCV into 5m buckets', () => {
    const out = aggregate1m(oneMin, '5m');
    expect(out).toHaveLength(2);
    const [a, b] = out;
    expect(a.t).toBe(base);
    expect(a.T).toBe(base + 5 * MIN - 1);
    expect(a.i).toBe('5m');
    expect(a.o).toBe('100');
    expect(a.h).toBe('110');
    expect(a.l).toBe('99');
    expect(a.c).toBe('105');
    expect(parseFloat(a.v)).toBe(5);
    expect(a.n).toBe(5);
    expect(b.t).toBe(base + 5 * MIN);
    expect(b.o).toBe('105');
    expect(b.c).toBe('106');
  });

  it('leaves a partial final bucket when input stops mid-interval', () => {
    const out = aggregate1m(oneMin.slice(0, 3), '5m');
    expect(out).toHaveLength(1);
    expect(out[0].h).toBe('110');
    expect(out[0].l).toBe('99');
    expect(out[0].c).toBe('102');
  });

  it('skips gaps without inventing buckets', () => {
    const gappy = [
      c1m(base, 100, 101, 99, 100),
      c1m(base + 60 * MIN, 200, 201, 199, 200), // an hour later
    ];
    const out = aggregate1m(gappy, '15m');
    expect(out).toHaveLength(2);
    expect(out[0].t).toBe(base);
    expect(out[1].t).toBe(bucketStart(base + 60 * MIN, 15 * MIN));
  });
});

describe('mergeIntoInterval', () => {
  const base = Date.UTC(2026, 2, 16, 12, 0);

  it('extends the current bucket', () => {
    const [agg] = aggregate1m([c1m(base, 100, 105, 99, 104)], '5m');
    const next = mergeIntoInterval(agg, c1m(base + MIN, 104, 120, 90, 95, 2), '5m');
    expect(next.t).toBe(base);
    expect(next.o).toBe('100');
    expect(next.h).toBe('120');
    expect(next.l).toBe('90');
    expect(next.c).toBe('95');
    expect(parseFloat(next.v)).toBe(3);
    // original untouched
    expect(agg.h).toBe('105');
  });

  it('opens a new bucket at the boundary', () => {
    const [agg] = aggregate1m([c1m(base + 4 * MIN, 100, 105, 99, 104)], '5m');
    const next = mergeIntoInterval(agg, c1m(base + 5 * MIN, 104, 106, 103, 105), '5m');
    expect(next.t).toBe(base + 5 * MIN);
    expect(next.o).toBe('104');
  });

  it('handles empty last (fresh chart)', () => {
    const next = mergeIntoInterval(undefined, c1m(base + 2 * MIN, 1, 2, 0.5, 1.5), '15m');
    expect(next.t).toBe(base);
    expect(next.i).toBe('15m');
  });
});

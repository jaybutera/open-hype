import { describe, it, expect } from 'vitest';
import { parseGex, formatGex } from '../types.ts';
import { gexLevelShapes, gexSummary } from '../levels.ts';
import { gexTickerFor } from '../symbols.ts';

const raw = {
  timestamp: 1792008000,
  ticker: 'SPX',
  spot: 7721.49,
  zero_gamma: 7721.49,
  major_pos_vol: 7720,
  major_pos_oi: 7870,
  major_neg_vol: 7730,
  major_neg_oi: 7720,
  sum_gex_vol: 1580317.03,
  sum_gex_oi: -39238.564,
  delta_risk_reversal: 4.364,
  strikes: [
    [7730, -94338.61, -2755.87, [-1, -2]],
    [7720, 1284909.29, -15536.45, [1, 2]],
    ['bad'],
    [7715, 319021.21, -2865.91, []],
  ],
  max_priors: [[7720, 1320844.821], ['x', 1]],
};

describe('parseGex', () => {
  it('reads the classic response, sorts strikes and drops bad rows', () => {
    const d = parseGex(raw, 'zero');
    expect(d.ticker).toBe('SPX');
    expect(d.timestamp).toBe(1792008000_000);
    expect(d.strikes.map(s => s.strike)).toEqual([7715, 7720, 7730]);
    expect(d.strikes[1]).toEqual({ strike: 7720, vol: 1284909.29, oi: -15536.45, priors: [1, 2] });
    expect(d.maxPriors).toEqual([[7720, 1320844.821]]);
  });

  it('throws on an upstream error body', () => {
    expect(() => parseGex({ error: 'Classic package does not have access.' }, 'zero')).toThrow(/Classic package/);
  });
});

describe('gexLevelShapes', () => {
  it('merges levels that share a price and applies the offset', () => {
    const shapes = gexLevelShapes(parseGex(raw, 'zero'), 48.69);
    const at7720 = shapes.find(s => s.price === 7720 + 48.69);
    expect(at7720?.text).toBe('+γ vol 7720 · -γ OI');
    expect(shapes).toHaveLength(4);
    expect(shapes.every(s => s.type === 'hline' && s.toNow)).toBe(true);
  });
});

describe('gexSummary', () => {
  it('lists the heaviest strikes first', () => {
    const s = gexSummary(parseGex(raw, 'zero'), 0, 2);
    expect(s.topStrikes).toEqual([
      { strike: 7720, vol: '1.28M', oi: '-15.5K' },
      { strike: 7715, vol: '319.0K', oi: '-2.9K' },
    ]);
    expect(s.asOf).toBe(1792008000_000);
  });
});

describe('gexTickerFor', () => {
  const known = new Set(['SPX', 'NDX', 'TSLA']);
  it('maps the xyz indexes and single names GEXBot lists', () => {
    expect(gexTickerFor('xyz:SP500', known)).toBe('SPX');
    expect(gexTickerFor('xyz:XYZ100', known)).toBe('NDX');
    expect(gexTickerFor('xyz:TSLA', known)).toBe('TSLA');
    expect(gexTickerFor('xyz:GOLD', known)).toBeNull();
    expect(gexTickerFor('BTC', known)).toBeNull();
  });
  it('trusts the index aliases before the list has loaded, nothing else', () => {
    expect(gexTickerFor('xyz:SP500', null)).toBe('SPX');
    expect(gexTickerFor('xyz:TSLA', null)).toBeNull();
  });
});

describe('formatGex', () => {
  it('rounds to a short unit string', () => {
    expect(formatGex(1284909.29)).toBe('1.28M');
    expect(formatGex(-94338.61)).toBe('-94.3K');
    expect(formatGex(3.38)).toBe('3.4');
  });
});

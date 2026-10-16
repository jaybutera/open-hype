import { describe, it, expect } from 'vitest';
import { parseGex, formatGex, scaleGex } from '../types.ts';
import { gexLevelShapes, gexPastLevelShapes, gexSummary } from '../levels.ts';
import { gexTickerFor, proxyCoinFor } from '../symbols.ts';

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
    expect(gexTickerFor('ETH', known)).toBeNull();
  });
  it('maps BTC to IBIT when GEXBot lists it, and back', () => {
    expect(gexTickerFor('BTC', new Set(['IBIT']))).toBe('IBIT');
    expect(gexTickerFor('BTC', null)).toBe('IBIT');
    expect(proxyCoinFor('IBIT')).toBe('BTC');
    expect(proxyCoinFor('SPX')).toBeNull();
  });
  it('trusts the index aliases before the list has loaded, nothing else', () => {
    expect(gexTickerFor('xyz:SP500', null)).toBe('SPX');
    expect(gexTickerFor('xyz:TSLA', null)).toBeNull();
  });
});

describe('scaleGex', () => {
  // IBIT at the 2026-10-15 close against the BTC perp's 15:59 ET close.
  const ibit = parseGex({
    ...raw,
    ticker: 'IBIT',
    spot: 46.59,
    zero_gamma: 46.75,
    major_pos_vol: 47,
    major_pos_oi: 47,
    major_neg_vol: 46.45,
    major_neg_oi: 44,
    strikes: [[46.5, -23.54, -1.03, [12, 20]], [47, 23.06, 39.83, []]],
    max_priors: [[46.5, 12.242]],
  }, 'full');

  it('moves every price onto the coin and leaves GEX alone', () => {
    const d = scaleGex(ibit, 'BTC', 82361);
    expect(d.spot).toBe(82361);
    expect(d.zeroGamma).toBe(82644);
    expect(d.majorPosVol).toBe(83086);
    expect(d.majorNegOi).toBe(77782);
    expect(d.strikes.map(s => s.strike)).toEqual([82202, 83086]);
    expect(d.strikes[0].vol).toBe(-23.54);
    expect(d.strikes[0].priors).toEqual([12, 20]);
    expect(d.maxPriors).toEqual([[82202, 12.242]]);
    expect(d.proxy).toMatchObject({ coin: 'BTC', coinPrice: 82361, etfSpot: 46.59 });
    expect(d.proxy!.factor).toBeCloseTo(1767.78, 2);
  });

  it('refuses a price it cannot scale by', () => {
    expect(() => scaleGex(ibit, 'BTC', NaN)).toThrow(/cannot scale/);
  });
});

describe('formatGex', () => {
  it('rounds to a short unit string', () => {
    expect(formatGex(1284909.29)).toBe('1.28M');
    expect(formatGex(-94338.61)).toBe('-94.3K');
    expect(formatGex(3.38)).toBe('3.4');
  });
});

describe('a reading before the session has volume', () => {
  // IBIT full, 2026-10-16 08:00:39 ET: GEXBot rolled to the new session with no volume yet.
  const early = {
    timestamp: 1792152039,
    ticker: 'IBIT',
    spot: 46.77,
    zero_gamma: 0,
    major_pos_vol: 0,
    major_pos_oi: 47,
    major_neg_vol: 0,
    major_neg_oi: 45,
    sum_gex_vol: 0,
    sum_gex_oi: 144.267,
    delta_risk_reversal: 0,
    strikes: [
      [1, 0, 0, [0, 0, 0, 0, 0]],
      [2, 0, 0, [0, 0, 0, 0, 0]],
      [3, 0, 0, [0, 0, 0, 0, 0]],
      [4, 0, 0, [0, 0, 0, 0, 0]],
      [44, 0, -5.99, [0, 0, 0, 0, 0]],
      [45, 0, -13.24, [0, 0, 0, 0, 0]],
      [46.5, 0, 2.2, [0, 0, 0, 0, 0]],
      [47, 0, 60.93, [0, 0, 0, 0, 0]],
      [48, 0, 27.44, [0, 0, 0, 0, 0]],
    ],
    max_priors: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],
  };
  // BTC / IBIT spot was 1766.5 at the reading.
  const d = scaleGex(parseGex(early, 'full'), 'BTC', 46.77 * 1766.5);

  it('has no zero gamma or volume majors, keeps the OI majors', () => {
    expect(d.zeroGamma).toBeNull();
    expect(d.majorPosVol).toBeNull();
    expect(d.majorNegVol).toBeNull();
    expect(d.majorPosOi).toBeCloseTo(83026, -1);
    expect(d.majorNegOi).toBeCloseTo(79493, -1);
    expect(d.maxPriors).toEqual([]);
  });

  it('draws only the OI lines', () => {
    const shapes = gexLevelShapes(d);
    expect(shapes.map(s => s.text)).toEqual([`+γ OI ${d.majorPosOi}`, `-γ OI ${d.majorNegOi}`]);
    expect(shapes.every(s => s.price > 1000)).toBe(true);
    expect(gexPastLevelShapes(d, '5m')).toEqual([]);
  });

  it('lists only strikes with gamma, heaviest OI first when there is no volume', () => {
    const s = gexSummary(d, 0, 8, '5m');
    expect(s.zeroGamma).toBeNull();
    expect(s.majorPosVol).toBeNull();
    expect(s.majorNegVol).toBeNull();
    expect(s.topStrikes.map(t => t.oi)).toEqual(['60.9', '27.4', '-13.2', '-6.0', '2.2']);
    expect(s.topStrikes.every(t => t.strike > 70000)).toBe(true);
    expect(s.lookbacks.every(l => l.majorPosVol === null && l.majorNegVol === null)).toBe(true);
  });
});

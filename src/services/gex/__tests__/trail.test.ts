import { describe, it, expect } from 'vitest';
import { GEX_LOOKBACKS, formatLookback, lookbacksFor, priorSlotFor } from '../lookbacks.ts';
import {
  GexSampleStore, etDayStart, isRth, lookbackRows, sampleFromRaw, tradingDaysStart, type GexSample,
} from '../samples.ts';
import { parseGex } from '../types.ts';
import { gexSummary } from '../levels.ts';
import { etToUtcMs } from '../../../utils/chartTime.ts';

const et = (wall: string) => etToUtcMs(wall)!;
const sample = (t: number, zg = 7700): GexSample => ({
  t, spot: 7710, zeroGamma: zg, majorPosVol: 7720, majorNegVol: 7690, majorPosOi: 7800, majorNegOi: 7600,
  sumGexVol: 1, sumGexOi: 2,
});

describe('lookbacksFor', () => {
  it('maps each chart interval to its two lookbacks', () => {
    expect(lookbacksFor('1m')).toEqual([15, 30]);
    expect(lookbacksFor('5m')).toEqual([30, 60]);
    expect(lookbacksFor('15m')).toEqual([60, 120]);
    expect(lookbacksFor('1h')).toEqual([120, 240]);
    expect(lookbacksFor('4h')).toEqual([120, 240]);
    expect(lookbacksFor('1d')).toEqual([120, 240]);
    expect(lookbacksFor('3m')).toEqual([120, 240]);
    expect(lookbacksFor(undefined)).toEqual([120, 240]);
    expect(Object.keys(GEX_LOOKBACKS)).toEqual(['1m', '5m', '15m', '1h', '4h', '1d']);
  });

  it('formats minutes as h or m', () => {
    expect([15, 30, 60, 120, 240, 90].map(formatLookback)).toEqual(['-15m', '-30m', '-1h', '-2h', '-4h', '-90m']);
  });

  it('picks the priors slot for the strike outline, capped at 30 min', () => {
    expect(priorSlotFor('1m')).toEqual({ index: 3, minutes: 15 });
    expect(priorSlotFor('5m')).toEqual({ index: 4, minutes: 30 });
    expect(priorSlotFor('1h')).toEqual({ index: 4, minutes: 30 });
  });
});

describe('parseGex priors', () => {
  it('keeps GEXBot order (1, 5, 10, 15, 30 min back) and slot positions', () => {
    const d = parseGex({
      timestamp: 1792008000, ticker: 'SPX', spot: 1, zero_gamma: 1, major_pos_vol: 1, major_pos_oi: 1,
      major_neg_vol: 1, major_neg_oi: 1,
      strikes: [[7745, 1, 0, [117502, 113058, null, 107636, 62717]]],
    }, 'zero');
    const p = d.strikes[0].priors;
    expect(p[0]).toBe(117502);
    expect(Number.isNaN(p[2])).toBe(true);
    expect(p[4]).toBe(62717);
  });
});

describe('GexSampleStore', () => {
  it('dedupes on t and keeps samples ascending', () => {
    const st = new GexSampleStore();
    const t0 = et('2026-10-15 10:00');
    expect(st.add('SPX/zero', sample(t0 + 60_000))).toBe(true);
    expect(st.add('SPX/zero', sample(t0 + 60_000))).toBe(false);
    expect(st.add('SPX/zero', sample(t0))).toBe(true);
    expect(st.range('SPX/zero', 0, Infinity).map(s => s.t)).toEqual([t0, t0 + 60_000]);
  });

  it('filters by from/to inclusive', () => {
    const st = new GexSampleStore();
    const t0 = et('2026-10-15 10:00');
    for (let i = 0; i < 10; i++) st.add('k', sample(t0 + i * 60_000));
    expect(st.range('k', t0 + 2 * 60_000, t0 + 4 * 60_000).map(s => (s.t - t0) / 60_000)).toEqual([2, 3, 4]);
    expect(st.range('k', t0 + 30_000, t0 + 90_000)).toHaveLength(1);
    expect(st.range('missing', 0, Infinity)).toEqual([]);
  });

  it('keeps the last 5 trading days, skipping weekends', () => {
    const st = new GexSampleStore(5);
    // Thu 2026-10-15 back to Fri 2026-10-09 is 5 trading days; Thu 10-08 is the 6th.
    st.add('k', sample(et('2026-10-08 15:59')));
    st.add('k', sample(et('2026-10-09 09:31')));
    st.add('k', sample(et('2026-10-15 10:00')));
    st.trim(et('2026-10-15 20:00'));
    expect(st.range('k', 0, Infinity).map(s => s.t)).toEqual([et('2026-10-09 09:31'), et('2026-10-15 10:00')]);
    expect(tradingDaysStart(et('2026-10-15 20:00'), 5)).toBe(et('2026-10-09 00:00'));
    // From a Sunday the window is Mon..Fri of the week before.
    expect(tradingDaysStart(et('2026-10-18 12:00'), 5)).toBe(et('2026-10-12 00:00'));
  });
});

describe('session helpers', () => {
  it('finds the ET day start and RTH', () => {
    expect(etDayStart(et('2026-10-15 22:30'))).toBe(et('2026-10-15 00:00'));
    expect(isRth(et('2026-10-15 09:29'))).toBe(false);
    expect(isRth(et('2026-10-15 09:30'))).toBe(true);
    expect(isRth(et('2026-10-15 15:59'))).toBe(true);
    expect(isRth(et('2026-10-15 16:00'))).toBe(false);
    expect(isRth(et('2026-10-17 11:00'))).toBe(false);
  });
});

describe('lookbackRows', () => {
  const t0 = et('2026-10-15 10:00');
  const samples = Array.from({ length: 61 }, (_, i) => sample(t0 + i * 60_000, 7700 + i));

  it('takes the last sample at or before latest minus N', () => {
    const rows = lookbackRows(samples, [15, 30]);
    expect(rows.map(r => [r.minutes, r.zeroGamma, r.asOf])).toEqual([
      [15, 7745, t0 + 45 * 60_000],
      [30, 7730, t0 + 30 * 60_000],
    ]);
  });

  it('leaves out a lookback older than the history', () => {
    expect(lookbackRows(samples, [60, 120]).map(r => r.minutes)).toEqual([60]);
    expect(lookbackRows([], [15])).toEqual([]);
  });

  it('feeds the chart snapshot summary for the interval', () => {
    const d = parseGex({
      timestamp: 1792008000, ticker: 'SPX', spot: 1, zero_gamma: 1, major_pos_vol: 1, major_pos_oi: 1,
      major_neg_vol: 1, major_neg_oi: 1, strikes: [],
    }, 'zero');
    expect(gexSummary(d, 0, 8, samples, '1m').lookbacks?.map(r => r.minutes)).toEqual([15, 30]);
    expect(gexSummary(d, 0).lookbacks).toEqual([]);
  });
});

describe('sampleFromRaw', () => {
  it('reads the headline fields and rejects a body without them', () => {
    const s = sampleFromRaw({
      timestamp: 1792008000.5, spot: 7721.49, zero_gamma: 7721.49, major_pos_vol: 7720, major_pos_oi: 7870,
      major_neg_vol: 7730, major_neg_oi: 7720, sum_gex_vol: 10, sum_gex_oi: -2,
    });
    expect(s).toEqual({
      t: 1792008000500, spot: 7721.49, zeroGamma: 7721.49, majorPosVol: 7720, majorNegVol: 7730,
      majorPosOi: 7870, majorNegOi: 7720, sumGexVol: 10, sumGexOi: -2,
    });
    expect(sampleFromRaw({ error: 'x' })).toBeNull();
  });
});

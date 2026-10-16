import { describe, it, expect } from 'vitest';
import { lookbackLabel, lookbacksFor } from '../lookbacks.ts';
import { gexLevelSet, gexPastLevelShapes, gexSummary, priorMajors } from '../levels.ts';
import { parseGex } from '../types.ts';

describe('lookbacksFor', () => {
  it('maps each interval to two GEXBot prior slots, shorter first', () => {
    expect(lookbacksFor('1m')).toEqual([{ minutes: 1, slot: 0 }, { minutes: 5, slot: 1 }]);
    expect(lookbacksFor('5m')).toEqual([{ minutes: 5, slot: 1 }, { minutes: 10, slot: 2 }]);
    expect(lookbacksFor('15m')).toEqual([{ minutes: 15, slot: 3 }, { minutes: 30, slot: 4 }]);
    for (const iv of ['1h', '4h', '1d', '3m', null, undefined]) {
      expect(lookbacksFor(iv)).toEqual([{ minutes: 15, slot: 3 }, { minutes: 30, slot: 4 }]);
    }
  });
  it('labels minutes back', () => {
    expect(lookbackLabel(5)).toBe('-5m');
    expect(lookbackLabel(30)).toBe('-30m');
  });
});

const T = 1792008000;
const raw = {
  timestamp: T,
  ticker: 'TSLA',
  spot: 362,
  zero_gamma: 360,
  major_pos_vol: 370,
  major_pos_oi: 380,
  major_neg_vol: 350,
  major_neg_oi: 340,
  strikes: [
    //      vol    oi   priors: -1m -5m  -10m -15m -30m
    [350, -900, -10, [-800, -50, -40, null, 1]],
    [355, -100, -10, [-100, -300, -500, null, 2]],
    [365, 200, 10, [150, 600, 100, null, 3]],
    [370, 1000, 10, [900, 400, 700, null, 4]],
  ],
};
const d = parseGex(raw, 'zero');

describe('priorMajors', () => {
  it('picks the largest positive and most negative prior at the slot', () => {
    expect(priorMajors(d, 1)).toEqual({ majorPosVol: 365, majorNegVol: 355, asOf: T * 1000 - 5 * 60_000 });
    expect(priorMajors(d, 2)).toEqual({ majorPosVol: 370, majorNegVol: 355, asOf: T * 1000 - 10 * 60_000 });
  });
  it('returns null when no finite value of that sign exists', () => {
    expect(priorMajors(d, 3)).toEqual({ majorPosVol: null, majorNegVol: null, asOf: T * 1000 - 15 * 60_000 });
    expect(priorMajors(d, 4).majorNegVol).toBeNull();
    expect(priorMajors(d, 4).majorPosVol).toBe(370);
  });
});

describe('gexPastLevelShapes', () => {
  it('draws moved majors from the lookback time to now and skips unchanged ones', () => {
    const shapes = gexPastLevelShapes(d, '5m', 2);
    expect(shapes.map(s => s.text)).toEqual(['+γ vol -5m 365', '-γ vol -5m 355', '-γ vol -10m 355']);
    expect(shapes[0]).toMatchObject({
      type: 'hline', price: 367, style: 'dotted', labelAt: 'start', toNow: true, from: T * 1000 - 5 * 60_000,
    });
    expect(shapes[0].color.startsWith('#0ecb81')).toBe(true);
    expect(shapes[1].color.startsWith('#f6465d')).toBe(true);
    expect(shapes[2].from).toBe(T * 1000 - 10 * 60_000);
  });
  it('joins the current levels in the GEX overlay set', () => {
    const set = gexLevelSet('xyz:TSLA', d, '5m');
    expect(set.shapes.filter(s => s.type === 'hline' && s.from !== undefined)).toHaveLength(3);
  });
});

describe('gexSummary lookbacks', () => {
  it('reports the past majors for the pane interval', () => {
    expect(gexSummary(d, 0, 8, '1m').lookbacks).toEqual([
      { minutes: 1, asOf: T * 1000 - 60_000, majorPosVol: 370, majorNegVol: 350 },
      { minutes: 5, asOf: T * 1000 - 5 * 60_000, majorPosVol: 365, majorNegVol: 355 },
    ]);
  });
});

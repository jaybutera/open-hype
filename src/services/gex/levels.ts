import type { HLineShape, OverlaySet } from '../ai/types.ts';
import { formatGex, type GexData } from './types.ts';
import { GEX_PRIOR_MINUTES, lookbackLabel, lookbacksFor } from './lookbacks.ts';

export const GEX_POS_COLOR = '#0ecb81';
export const GEX_NEG_COLOR = '#f6465d';
export const GEX_ZERO_COLOR = '#c9ced6';

interface Level { price: number; text: string; color: string; style: 'solid' | 'dashed' }

/** Zero gamma and the four major strikes as labelled lines. Same-price levels share one line. */
export function gexLevelShapes(d: GexData, offset = 0): HLineShape[] {
  const levels: Level[] = [
    { price: d.zeroGamma, text: `0γ ${d.zeroGamma}`, color: GEX_ZERO_COLOR, style: 'dashed' },
    { price: d.majorPosVol, text: `+γ vol ${d.majorPosVol}`, color: GEX_POS_COLOR, style: 'solid' },
    { price: d.majorNegVol, text: `-γ vol ${d.majorNegVol}`, color: GEX_NEG_COLOR, style: 'solid' },
    { price: d.majorPosOi, text: `+γ OI ${d.majorPosOi}`, color: GEX_POS_COLOR, style: 'dashed' },
    { price: d.majorNegOi, text: `-γ OI ${d.majorNegOi}`, color: GEX_NEG_COLOR, style: 'dashed' },
  ];
  const byPrice = new Map<number, Level>();
  for (const l of levels) {
    const prev = byPrice.get(l.price);
    if (prev) prev.text = `${prev.text} · ${l.text.replace(/ [\d.]+$/, '')}`;
    else byPrice.set(l.price, { ...l });
  }
  return [...byPrice.values()].map(l => ({
    type: 'hline',
    price: l.price + offset,
    text: l.text,
    color: l.color,
    style: l.style,
    toNow: true,
  }));
}

export interface PriorMajors {
  /** Strike with the largest positive volume GEX at that prior, or null. */
  majorPosVol: number | null;
  /** Strike with the most negative volume GEX at that prior, or null. */
  majorNegVol: number | null;
  /** UTC ms the prior refers to: the reading's time minus the slot's minutes. */
  asOf: number;
}

/**
 * The major +/- volume gamma strikes as they were at GexStrike.priors[slot]
 * (slot i is GEX_PRIOR_MINUTES[i] minutes before the reading).
 */
export function priorMajors(data: GexData, slot: number): PriorMajors {
  let pos: number | null = null;
  let neg: number | null = null;
  let maxPos = 0;
  let minNeg = 0;
  for (const s of data.strikes) {
    const v = s.priors[slot];
    if (v === undefined || !Number.isFinite(v)) continue;
    if (v > maxPos) { maxPos = v; pos = s.strike; }
    if (v < minNeg) { minNeg = v; neg = s.strike; }
  }
  const minutes = GEX_PRIOR_MINUTES[slot] ?? 0;
  return { majorPosVol: pos, majorNegVol: neg, asOf: data.timestamp - minutes * 60_000 };
}

/** Line alpha (hex byte) per lookback, shorter first. */
const LOOKBACK_ALPHA = ['99', '66'];

/**
 * Dotted lines from each lookback's time to now at the major +/- volume gamma
 * strikes as they were then, skipped when the strike has not moved.
 */
export function gexPastLevelShapes(d: GexData, interval: string | null | undefined, offset = 0): HLineShape[] {
  const out: HLineShape[] = [];
  lookbacksFor(interval).forEach(({ minutes, slot }, i) => {
    const p = priorMajors(d, slot);
    const from = d.timestamp - minutes * 60_000;
    const alpha = LOOKBACK_ALPHA[i] ?? '66';
    const lines: Array<[number | null, number, string, string]> = [
      [p.majorPosVol, d.majorPosVol, '+γ vol', GEX_POS_COLOR],
      [p.majorNegVol, d.majorNegVol, '-γ vol', GEX_NEG_COLOR],
    ];
    for (const [past, now, name, color] of lines) {
      if (past === null || past === now) continue;
      out.push({
        type: 'hline',
        price: past + offset,
        text: `${name} ${lookbackLabel(minutes)} ${past}`,
        color: color + alpha,
        style: 'dotted',
        from,
        toNow: true,
        labelAt: 'start',
      });
    }
  });
  return out;
}

export function gexLevelSet(asset: string, d: GexData, interval: string | null | undefined, offset = 0): OverlaySet {
  return {
    id: '__gex',
    batch: '__gex',
    name: `GEX ${d.ticker}`,
    asset,
    color: GEX_ZERO_COLOR,
    createdAt: d.timestamp,
    shapes: [...gexLevelShapes(d, offset), ...gexPastLevelShapes(d, interval, offset)],
  };
}

/** What the AI gets in a chart snapshot: the headline levels plus the heaviest strikes. */
export interface GexSummary {
  ticker: string;
  dte: GexData['dte'];
  /** UTC ms of the GEXBot snapshot; stale after the close. */
  asOf: number;
  /** Added to every GEXBot price before drawing (user setting; 0 unless the perp trades away from cash). */
  offset: number;
  spot: number;
  zeroGamma: number;
  majorPosVol: number;
  majorNegVol: number;
  majorPosOi: number;
  majorNegOi: number;
  sumGexVol: number;
  sumGexOi: number;
  /** Largest |volume GEX| strikes, biggest first; `vol`/`oi` are rounded strings like "1.28M". */
  topStrikes: Array<{ strike: number; vol: string; oi: string }>;
  /**
   * The major +/- volume gamma strikes at the two lookbacks for the chart's
   * interval, from GEXBot's per-strike priors (see lookbacksFor). Prices are
   * GEXBot's, without `offset`; null when no strike had that sign then.
   */
  lookbacks: Array<{ minutes: number; asOf: number; majorPosVol: number | null; majorNegVol: number | null }>;
}

export function gexSummary(d: GexData, offset: number, top = 8, interval?: string | null): GexSummary {
  const topStrikes = [...d.strikes]
    .sort((a, b) => Math.abs(b.vol) - Math.abs(a.vol))
    .slice(0, top)
    .map(s => ({ strike: s.strike, vol: formatGex(s.vol), oi: formatGex(s.oi) }));
  return {
    ticker: d.ticker,
    dte: d.dte,
    asOf: d.timestamp,
    offset,
    spot: d.spot,
    zeroGamma: d.zeroGamma,
    majorPosVol: d.majorPosVol,
    majorNegVol: d.majorNegVol,
    majorPosOi: d.majorPosOi,
    majorNegOi: d.majorNegOi,
    sumGexVol: d.sumGexVol,
    sumGexOi: d.sumGexOi,
    topStrikes,
    lookbacks: lookbacksFor(interval).map(({ minutes, slot }) => ({ minutes, ...priorMajors(d, slot) })),
  };
}

import type { HLineShape, OverlaySet } from '../ai/types.ts';
import { formatGex, type GexData } from './types.ts';

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

export function gexLevelSet(asset: string, d: GexData, offset = 0): OverlaySet {
  return {
    id: '__gex',
    batch: '__gex',
    name: `GEX ${d.ticker}`,
    asset,
    color: GEX_ZERO_COLOR,
    createdAt: d.timestamp,
    shapes: gexLevelShapes(d, offset),
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
}

export function gexSummary(d: GexData, offset: number, top = 8): GexSummary {
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
  };
}

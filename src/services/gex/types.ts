/** GEXBot classic feed, as served by the dev server at /api/gex/:ticker/:dte. */

export type GexDte = 'zero' | 'one' | 'full';

export const GEX_DTES: Array<{ id: GexDte; label: string; title: string }> = [
  { id: 'zero', label: '0DTE', title: 'Contracts expiring today' },
  { id: 'one', label: '1DTE', title: 'Contracts expiring tomorrow' },
  { id: 'full', label: 'All', title: 'All expirations' },
];

export interface GexStrike {
  strike: number;
  /** Gamma exposure from today's volume. */
  vol: number;
  /** Gamma exposure from open interest. */
  oi: number;
  /** This strike's volume GEX 1, 5, 10, 15 and 30 minutes earlier, in that order (most recent first); see GEX_PRIOR_MINUTES. */
  priors: number[];
}

export interface GexData {
  ticker: string;
  dte: GexDte;
  /** UTC ms of the snapshot. */
  timestamp: number;
  spot: number;
  /**
   * Zero gamma and the major strikes; null when GEXBot sends 0, which it does
   * for the volume levels before the session has any volume (early morning).
   */
  zeroGamma: number | null;
  majorPosVol: number | null;
  majorPosOi: number | null;
  majorNegVol: number | null;
  majorNegOi: number | null;
  sumGexVol: number;
  sumGexOi: number;
  deltaRiskReversal: number;
  strikes: GexStrike[];
  /** [strike, gex] of the biggest volume-GEX build over the last 1, 5, 10, 15, 30 and 60 minutes, in that order (GEX_MAX_PRIOR_MINUTES). */
  maxPriors: Array<[number, number]>;
  /** Set when the reading is an ETF's, rescaled to a perp coin's price (scaleGex); every price above is then in coin terms. */
  proxy?: GexProxy;
}

export interface GexProxy {
  /** Perp coin the strikes were rescaled to, e.g. BTC. */
  coin: string;
  /** coinPrice / etfSpot: one ETF dollar in coin dollars. */
  factor: number;
  /** The coin's 1m close at the reading's time. */
  coinPrice: number;
  /** The ETF's spot in the reading, before scaling. */
  etfSpot: number;
}

/** 5 significant digits: 82644.37 -> 82644, 3123.456 -> 3123.5. */
const sig5 = (v: number) => Number(v.toPrecision(5));

/**
 * Rescale an ETF's reading to its coin: every price (spot, zero gamma, the
 * majors, strikes, maxPriors strikes) times coinPrice / spot. GEX values are
 * left as they are.
 */
export function scaleGex(d: GexData, coin: string, coinPrice: number): GexData {
  const factor = coinPrice / d.spot;
  if (!Number.isFinite(factor) || factor <= 0) throw new Error(`gex: cannot scale ${d.ticker} to ${coin}`);
  const px = (v: number) => sig5(v * factor);
  const lvl = (v: number | null) => (v === null ? null : px(v));
  return {
    ...d,
    spot: px(d.spot),
    zeroGamma: lvl(d.zeroGamma),
    majorPosVol: lvl(d.majorPosVol),
    majorPosOi: lvl(d.majorPosOi),
    majorNegVol: lvl(d.majorNegVol),
    majorNegOi: lvl(d.majorNegOi),
    strikes: d.strikes.map(s => ({ ...s, strike: px(s.strike) })),
    maxPriors: d.maxPriors.map(([k, g]) => [px(k), g]),
    proxy: { coin, factor, coinPrice, etfSpot: d.spot },
  };
}

function num(v: unknown, name: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`gex: ${name} is not a number`);
  return n;
}

/** A price level from GEXBot: 0 (or below) means it has none yet, never a real price. */
function level(v: unknown, name: string): number | null {
  const n = num(v ?? 0, name);
  return n > 0 ? n : null;
}

/** Turn a raw GEXBot response into GexData; throws when the shape is off. */
export function parseGex(raw: unknown, dte: GexDte): GexData {
  if (!raw || typeof raw !== 'object') throw new Error('gex: response is not an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.error === 'string') throw new Error(r.error);
  const rows = Array.isArray(r.strikes) ? r.strikes : [];
  const strikes: GexStrike[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const strike = Number(row[0]);
    const vol = Number(row[1]);
    const oi = Number(row[2]);
    if (![strike, vol, oi].every(Number.isFinite)) continue;
    // Keep positions: index i is GEX_PRIOR_MINUTES[i] back, so a missing value stays as NaN.
    const priors = Array.isArray(row[3]) ? row[3].map(v => (v == null ? NaN : Number(v))) : [];
    strikes.push({ strike, vol, oi, priors });
  }
  strikes.sort((a, b) => a.strike - b.strike);
  const maxPriors: Array<[number, number]> = [];
  if (Array.isArray(r.max_priors)) {
    for (const p of r.max_priors) {
      // GEXBot sends [0, 0] for a window with no build yet.
      if (Array.isArray(p) && Number(p[0]) > 0 && Number.isFinite(Number(p[1]))) {
        maxPriors.push([Number(p[0]), Number(p[1])]);
      }
    }
  }
  return {
    ticker: String(r.ticker ?? ''),
    dte,
    timestamp: num(r.timestamp, 'timestamp') * 1000,
    spot: num(r.spot, 'spot'),
    zeroGamma: level(r.zero_gamma, 'zero_gamma'),
    majorPosVol: level(r.major_pos_vol, 'major_pos_vol'),
    majorPosOi: level(r.major_pos_oi, 'major_pos_oi'),
    majorNegVol: level(r.major_neg_vol, 'major_neg_vol'),
    majorNegOi: level(r.major_neg_oi, 'major_neg_oi'),
    sumGexVol: num(r.sum_gex_vol ?? 0, 'sum_gex_vol'),
    sumGexOi: num(r.sum_gex_oi ?? 0, 'sum_gex_oi'),
    deltaRiskReversal: num(r.delta_risk_reversal ?? 0, 'delta_risk_reversal'),
    strikes,
    maxPriors,
  };
}

/** 1284909 -> "1.28M", -94338 -> "-94.3K". */
export function formatGex(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(a >= 100 ? 0 : 1)}`;
}

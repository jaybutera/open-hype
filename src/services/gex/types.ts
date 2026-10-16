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
  zeroGamma: number;
  majorPosVol: number;
  majorPosOi: number;
  majorNegVol: number;
  majorNegOi: number;
  sumGexVol: number;
  sumGexOi: number;
  deltaRiskReversal: number;
  strikes: GexStrike[];
  /** [strike, gex] of the biggest volume-GEX build over the last 1, 5, 10, 15, 30 and 60 minutes, in that order (GEX_MAX_PRIOR_MINUTES). */
  maxPriors: Array<[number, number]>;
}

function num(v: unknown, name: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`gex: ${name} is not a number`);
  return n;
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
      if (Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))) {
        maxPriors.push([Number(p[0]), Number(p[1])]);
      }
    }
  }
  return {
    ticker: String(r.ticker ?? ''),
    dte,
    timestamp: num(r.timestamp, 'timestamp') * 1000,
    spot: num(r.spot, 'spot'),
    zeroGamma: num(r.zero_gamma, 'zero_gamma'),
    majorPosVol: num(r.major_pos_vol, 'major_pos_vol'),
    majorPosOi: num(r.major_pos_oi, 'major_pos_oi'),
    majorNegVol: num(r.major_neg_vol, 'major_neg_vol'),
    majorNegOi: num(r.major_neg_oi, 'major_neg_oi'),
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

export interface AssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  /** HIP-3 only: deployer fee share, e.g. "1.0". */
  deployerFeeScale?: string;
  /** HIP-3 only: "enabled" cuts fees by 90%. */
  growthMode?: string;
}

export interface Meta {
  universe: AssetMeta[];
}

export interface AssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
  impactPxs: [string, string];
}

export interface CandleData {
  t: number;   // open time ms
  T: number;   // close time ms
  s: string;   // coin
  i: string;   // interval
  o: string;   // open price (string from API)
  h: string;   // high
  l: string;   // low
  c: string;   // close
  v: string;   // volume
  n: number;
}

export type CandleInterval =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M';

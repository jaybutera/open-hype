import type { OptionType } from './types';

export const RISK_FREE_RATE = 0.045;
export const SECONDS_PER_YEAR = 31_536_000;

export interface GreeksInputs {
  underlyingPrice: number;
  strike: number;
  timeToExpiry: number;
  volatility: number;
  type: OptionType;
  riskFreeRate?: number;
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
}

export function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function yearsUntil(expirationUnixSeconds: number, nowUnixSeconds: number = Date.now() / 1000): number {
  return Math.max(0, (expirationUnixSeconds - nowUnixSeconds) / SECONDS_PER_YEAR);
}

function intrinsic(S: number, K: number, type: OptionType): number {
  return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
}

export function blackScholes(inputs: GreeksInputs): Greeks {
  const { underlyingPrice: S, strike: K, timeToExpiry: T, volatility: sigma, type } = inputs;
  const r = inputs.riskFreeRate ?? RISK_FREE_RATE;

  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    const price = intrinsic(S, K, type);
    const delta = T <= 0 ? (type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0)) : 0;
    return { price, delta, gamma: 0, vega: 0, theta: 0, rho: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);
  const nd1 = normPdf(d1);
  const discount = Math.exp(-r * T);

  if (type === 'call') {
    const price = S * Nd1 - K * discount * Nd2;
    const delta = Nd1;
    const gamma = nd1 / (S * sigma * sqrtT);
    const vega = S * nd1 * sqrtT / 100;
    const theta = (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * discount * Nd2) / 365;
    const rho = (K * T * discount * Nd2) / 100;
    return { price, delta, gamma, vega, theta, rho };
  } else {
    const price = K * discount * (1 - Nd2) - S * (1 - Nd1);
    const delta = Nd1 - 1;
    const gamma = nd1 / (S * sigma * sqrtT);
    const vega = S * nd1 * sqrtT / 100;
    const theta = (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * discount * (1 - Nd2)) / 365;
    const rho = (-K * T * discount * (1 - Nd2)) / 100;
    return { price, delta, gamma, vega, theta, rho };
  }
}

import type { OptionContract } from './types';
import { blackScholes, yearsUntil } from './greeks';

export type ChainMetricKey = 'iv' | 'delta' | 'volume' | 'oi';

export interface ChainMetricDef {
  key: ChainMetricKey;
  label: string;
  description: string;
}

export const CHAIN_METRICS: Record<ChainMetricKey, ChainMetricDef> = {
  iv: { key: 'iv', label: 'IV', description: 'Implied Volatility' },
  delta: { key: 'delta', label: 'Δ', description: 'Black-Scholes Delta' },
  volume: { key: 'volume', label: 'Vol', description: 'Daily Volume' },
  oi: { key: 'oi', label: 'OI', description: 'Open Interest' },
};

export const ALL_METRICS: ChainMetricKey[] = ['iv', 'delta', 'volume', 'oi'];
export const DEFAULT_METRICS: [ChainMetricKey, ChainMetricKey] = ['iv', 'oi'];
export const METRIC_COUNT = 2;

const STORAGE_KEY = 'hl-options-chain-metrics';

function isMetricKey(v: unknown): v is ChainMetricKey {
  return v === 'iv' || v === 'delta' || v === 'volume' || v === 'oi';
}

function storageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export function normalizeMetrics(input: readonly unknown[]): [ChainMetricKey, ChainMetricKey] {
  const keys: ChainMetricKey[] = [];
  for (const v of input) {
    if (isMetricKey(v) && !keys.includes(v)) keys.push(v);
    if (keys.length === METRIC_COUNT) break;
  }
  for (const fallback of DEFAULT_METRICS) {
    if (keys.length === METRIC_COUNT) break;
    if (!keys.includes(fallback)) keys.push(fallback);
  }
  return [keys[0]!, keys[1]!];
}

export function loadChainMetrics(): [ChainMetricKey, ChainMetricKey] {
  if (!storageAvailable()) return [...DEFAULT_METRICS];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_METRICS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_METRICS];
    return normalizeMetrics(parsed);
  } catch {
    return [...DEFAULT_METRICS];
  }
}

export function saveChainMetrics(metrics: [ChainMetricKey, ChainMetricKey]): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  } catch {
    // ignore quota / privacy errors
  }
}

export function toggleMetric(
  current: [ChainMetricKey, ChainMetricKey],
  clicked: ChainMetricKey,
): [ChainMetricKey, ChainMetricKey] {
  const idx = current.indexOf(clicked);
  if (idx !== -1) {
    // Already selected — pick a replacement so we always keep two columns.
    // The "other" slot keeps its key; the clicked slot rotates to the next
    // unused metric in ALL_METRICS order.
    const other = current[1 - idx]!;
    const next = ALL_METRICS.find((k) => k !== clicked && k !== other);
    if (!next) return current;
    const result: ChainMetricKey[] = [...current];
    result[idx] = next;
    return [result[0]!, result[1]!];
  }
  // Not yet selected — replace the rightmost slot, keeping the leftmost.
  return [current[0]!, clicked];
}

export function formatMetricValue(
  key: ChainMetricKey,
  contract: OptionContract | undefined,
  ctx: { underlyingPrice: number; nowSec?: number },
): string {
  if (!contract) return '';
  switch (key) {
    case 'iv':
      return fmtIv(contract.iv);
    case 'delta':
      return fmtDelta(contract, ctx);
    case 'volume':
      return fmtInt(contract.volume);
    case 'oi':
      return fmtInt(contract.openInterest);
  }
}

function fmtIv(iv: number): string {
  if (!Number.isFinite(iv) || iv <= 0) return '—';
  if (iv > 5) return `${(iv * 100).toFixed(0)}%*`;
  return `${(iv * 100).toFixed(1)}%`;
}

function fmtInt(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtDelta(contract: OptionContract, ctx: { underlyingPrice: number; nowSec?: number }): string {
  const T = yearsUntil(contract.expiration, ctx.nowSec);
  if (T <= 0 || !Number.isFinite(contract.iv) || contract.iv <= 0 || ctx.underlyingPrice <= 0) {
    return '—';
  }
  // Clamp absurd IVs (deep-wing garbage) — matches the IV column's `*` flagging.
  const sigma = Math.min(contract.iv, 5);
  const { delta } = blackScholes({
    underlyingPrice: ctx.underlyingPrice,
    strike: contract.strike,
    timeToExpiry: T,
    volatility: sigma,
    type: contract.type,
  });
  if (!Number.isFinite(delta)) return '—';
  const sign = delta < 0 ? '-' : '';
  return `${sign}${Math.abs(delta).toFixed(2)}`;
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ALL_METRICS,
  CHAIN_METRICS,
  DEFAULT_METRICS,
  METRIC_COUNT,
  type ChainMetricKey,
  formatMetricValue,
  loadChainMetrics,
  normalizeMetrics,
  saveChainMetrics,
  toggleMetric,
} from '../chainMetrics';
import type { OptionContract } from '../types';

function makeContract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    symbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: 400,
    expiration: 1776384000, // 2026-04-17 UTC midnight
    bid: 5,
    ask: 5.2,
    last: 5.1,
    iv: 0.45,
    volume: 1234,
    openInterest: 5678,
    inTheMoney: false,
    ...overrides,
  };
}

describe('CHAIN_METRICS constants', () => {
  it('lists exactly four metric keys', () => {
    expect(ALL_METRICS).toHaveLength(4);
    expect(METRIC_COUNT).toBe(2);
    expect(DEFAULT_METRICS).toHaveLength(2);
  });

  it('has a definition for every metric key', () => {
    for (const key of ALL_METRICS) {
      expect(CHAIN_METRICS[key]).toBeDefined();
      expect(CHAIN_METRICS[key].label.length).toBeGreaterThan(0);
    }
  });

  it('default metrics are IV + OI per spec', () => {
    expect(DEFAULT_METRICS).toEqual(['iv', 'oi']);
  });
});

describe('normalizeMetrics', () => {
  it('keeps valid metrics', () => {
    expect(normalizeMetrics(['delta', 'volume'])).toEqual(['delta', 'volume']);
  });

  it('dedupes repeats', () => {
    expect(normalizeMetrics(['iv', 'iv', 'oi'])).toEqual(['iv', 'oi']);
  });

  it('drops invalid entries and backfills from defaults', () => {
    expect(normalizeMetrics(['delta', 'nope'])).toEqual(['delta', 'iv']);
  });

  it('falls back to defaults when empty', () => {
    expect(normalizeMetrics([])).toEqual(['iv', 'oi']);
  });

  it('truncates to exactly METRIC_COUNT keys', () => {
    expect(normalizeMetrics(['iv', 'delta', 'volume', 'oi'])).toEqual(['iv', 'delta']);
  });
});

describe('toggleMetric', () => {
  it('adds a new metric by replacing the rightmost slot', () => {
    expect(toggleMetric(['iv', 'oi'], 'delta')).toEqual(['iv', 'delta']);
  });

  it('rotates an already-selected metric to the next unused slot in ALL_METRICS order', () => {
    // ['iv', 'oi'] click 'iv' → iv rotates to next-unused ('delta') per ALL_METRICS order.
    expect(toggleMetric(['iv', 'oi'], 'iv')).toEqual(['delta', 'oi']);
  });

  it('rotation happens on the clicked slot only, other slot preserved', () => {
    // clicking the second metric should replace only the second.
    expect(toggleMetric(['iv', 'oi'], 'oi')).toEqual(['iv', 'delta']);
  });

  it('preserves order when picking a different rightmost', () => {
    expect(toggleMetric(['delta', 'oi'], 'volume')).toEqual(['delta', 'volume']);
  });

  it('is idempotent for the same active-metric click when no rotation target available', () => {
    // With all 4 metrics selected we never get here (only 2 slots), but the
    // rotation must always find SOME other key given 4 total metrics.
    const rotated = toggleMetric(['iv', 'oi'], 'iv');
    expect(rotated).not.toEqual(['iv', 'oi']);
    expect(rotated).toHaveLength(2);
  });
});

describe('loadChainMetrics / saveChainMetrics', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const mock = {
      getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
      setItem: vi.fn((k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: vi.fn((k: string) => {
        store.delete(k);
      }),
      clear: vi.fn(() => store.clear()),
      key: vi.fn(() => null),
      length: 0,
    };
    vi.stubGlobal('window', { localStorage: mock });
  });

  it('returns defaults when nothing stored', () => {
    expect(loadChainMetrics()).toEqual(['iv', 'oi']);
  });

  it('round-trips saved metrics', () => {
    saveChainMetrics(['delta', 'volume']);
    expect(loadChainMetrics()).toEqual(['delta', 'volume']);
  });

  it('ignores corrupt JSON and returns defaults', () => {
    store.set('hl-options-chain-metrics', 'not json');
    expect(loadChainMetrics()).toEqual(['iv', 'oi']);
  });

  it('ignores non-array JSON', () => {
    store.set('hl-options-chain-metrics', '{}');
    expect(loadChainMetrics()).toEqual(['iv', 'oi']);
  });

  it('filters out unknown keys, backfilling defaults', () => {
    store.set('hl-options-chain-metrics', JSON.stringify(['delta', 'zorp']));
    expect(loadChainMetrics()).toEqual(['delta', 'iv']);
  });

  it('no-ops gracefully without window', () => {
    vi.stubGlobal('window', undefined);
    expect(loadChainMetrics()).toEqual(['iv', 'oi']);
    expect(() => saveChainMetrics(['delta', 'volume'])).not.toThrow();
  });
});

describe('formatMetricValue', () => {
  const nowSec = 1776384000 - 30 * 86_400; // 30 days before a 2026-04-17 expiration
  const ctx = { underlyingPrice: 400, nowSec };

  it('returns empty string for undefined contract', () => {
    expect(formatMetricValue('iv', undefined, ctx)).toBe('');
  });

  it('formats IV as percent with one decimal', () => {
    const c = makeContract({ iv: 0.3256 });
    expect(formatMetricValue('iv', c, ctx)).toBe('32.6%');
  });

  it('flags absurd IVs with asterisk', () => {
    const c = makeContract({ iv: 40 });
    expect(formatMetricValue('iv', c, ctx)).toMatch(/\*$/);
  });

  it('renders IV em-dash for zero or negative IV', () => {
    const c = makeContract({ iv: 0 });
    expect(formatMetricValue('iv', c, ctx)).toBe('—');
  });

  it('formats volume compactly (k for thousands, M for millions)', () => {
    expect(formatMetricValue('volume', makeContract({ volume: 0 }), ctx)).toBe('0');
    expect(formatMetricValue('volume', makeContract({ volume: 42 }), ctx)).toBe('42');
    expect(formatMetricValue('volume', makeContract({ volume: 1500 }), ctx)).toBe('1.5k');
    expect(formatMetricValue('volume', makeContract({ volume: 1_500_000 }), ctx)).toBe('1.5M');
  });

  it('formats OI the same way as volume', () => {
    expect(formatMetricValue('oi', makeContract({ openInterest: 2500 }), ctx)).toBe('2.5k');
  });

  it('returns em-dash for delta when expiration has passed', () => {
    const c = makeContract({ expiration: nowSec - 86_400 });
    expect(formatMetricValue('delta', c, { ...ctx, nowSec })).toBe('—');
  });

  it('returns em-dash for delta when IV missing', () => {
    const c = makeContract({ iv: 0 });
    expect(formatMetricValue('delta', c, ctx)).toBe('—');
  });

  it('computes a plausible delta for an ATM call', () => {
    const c = makeContract({ strike: 400, iv: 0.4, type: 'call' });
    const out = formatMetricValue('delta', c, ctx);
    const v = parseFloat(out);
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(0.8);
  });

  it('delta for ATM put is negative', () => {
    const c = makeContract({ strike: 400, iv: 0.4, type: 'put' });
    const out = formatMetricValue('delta', c, ctx);
    expect(out.startsWith('-')).toBe(true);
    const v = parseFloat(out);
    expect(v).toBeGreaterThan(-0.8);
    expect(v).toBeLessThan(-0.2);
  });

  it('delta for deep ITM call approaches 1', () => {
    const c = makeContract({ strike: 100, iv: 0.4, type: 'call' });
    const out = formatMetricValue('delta', c, ctx);
    const v = parseFloat(out);
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('delta clamps absurd IV before pricing (no NaN / infinity)', () => {
    const c = makeContract({ iv: 100 });
    const out = formatMetricValue('delta', c, ctx);
    expect(out).not.toBe('—');
    const v = parseFloat(out);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('metric types lint', () => {
  it('exported ALL_METRICS matches the union type', () => {
    const allow: Record<ChainMetricKey, true> = {
      iv: true,
      delta: true,
      volume: true,
      oi: true,
    };
    for (const k of ALL_METRICS) {
      expect(allow[k]).toBe(true);
    }
  });
});

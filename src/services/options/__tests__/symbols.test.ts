import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  POPULAR_SYMBOLS,
  getRecentSymbols,
  addRecentSymbol,
  clearRecentSymbols,
  searchPopularSymbols,
} from '../symbols';

describe('POPULAR_SYMBOLS', () => {
  it('has no duplicate tickers', () => {
    const seen = new Set<string>();
    for (const s of POPULAR_SYMBOLS) {
      expect(seen.has(s.symbol)).toBe(false);
      seen.add(s.symbol);
    }
  });

  it('all tickers are uppercase non-empty', () => {
    for (const s of POPULAR_SYMBOLS) {
      expect(s.symbol).toBe(s.symbol.toUpperCase());
      expect(s.symbol.length).toBeGreaterThan(0);
      expect(s.name.length).toBeGreaterThan(0);
    }
  });

  it('contains expected anchors (TSLA, SPY, QQQ, IBIT, FBTC)', () => {
    const syms = new Set(POPULAR_SYMBOLS.map((s) => s.symbol));
    expect(syms.has('TSLA')).toBe(true);
    expect(syms.has('SPY')).toBe(true);
    expect(syms.has('QQQ')).toBe(true);
    expect(syms.has('IBIT')).toBe(true);
    expect(syms.has('FBTC')).toBe(true);
  });

  it('has a reasonable minimum size (>= 150 symbols)', () => {
    expect(POPULAR_SYMBOLS.length).toBeGreaterThanOrEqual(150);
  });
});

describe('searchPopularSymbols', () => {
  it('returns empty for empty query', () => {
    expect(searchPopularSymbols('')).toEqual([]);
    expect(searchPopularSymbols('   ')).toEqual([]);
  });

  it('exact match comes first', () => {
    const hits = searchPopularSymbols('TSLA');
    expect(hits[0].symbol).toBe('TSLA');
  });

  it('is case-insensitive', () => {
    const lower = searchPopularSymbols('tsla');
    const upper = searchPopularSymbols('TSLA');
    expect(lower[0].symbol).toBe('TSLA');
    expect(lower).toEqual(upper);
  });

  it('prefix matches ranked ahead of substring matches', () => {
    const hits = searchPopularSymbols('SP');
    // SPY starts with SP, MSFT contains neither — prefix group dominates
    expect(hits.some((h) => h.symbol === 'SPY')).toBe(true);
    const prefixHits = hits.filter((h) => h.symbol.startsWith('SP'));
    // all prefix hits should appear before any non-prefix hits
    for (let i = 0; i < hits.length; i++) {
      if (!hits[i].symbol.startsWith('SP')) {
        // no more prefix hits after a non-prefix hit
        for (let j = i; j < hits.length; j++) {
          expect(hits[j].symbol.startsWith('SP')).toBe(false);
        }
        break;
      }
    }
    expect(prefixHits.length).toBeGreaterThan(0);
  });

  it('falls back to name match when symbol has no overlap', () => {
    const hits = searchPopularSymbols('MICROSOFT');
    expect(hits.some((h) => h.symbol === 'MSFT')).toBe(true);
  });

  it('respects limit', () => {
    const hits = searchPopularSymbols('A', 3);
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it('returns SymbolHit shape with name', () => {
    const hits = searchPopularSymbols('AAPL');
    expect(hits[0]).toMatchObject({ symbol: 'AAPL', name: expect.any(String) });
  });
});

describe('recent-symbols localStorage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
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

  it('returns empty list when nothing stored', () => {
    expect(getRecentSymbols()).toEqual([]);
  });

  it('addRecentSymbol pushes to front', () => {
    expect(addRecentSymbol('TSLA')).toEqual(['TSLA']);
    expect(addRecentSymbol('AAPL')).toEqual(['AAPL', 'TSLA']);
    expect(addRecentSymbol('NVDA')).toEqual(['NVDA', 'AAPL', 'TSLA']);
    expect(getRecentSymbols()).toEqual(['NVDA', 'AAPL', 'TSLA']);
  });

  it('addRecentSymbol deduplicates (moves to front)', () => {
    addRecentSymbol('TSLA');
    addRecentSymbol('AAPL');
    addRecentSymbol('NVDA');
    expect(addRecentSymbol('TSLA')).toEqual(['TSLA', 'NVDA', 'AAPL']);
  });

  it('addRecentSymbol upper-cases and trims', () => {
    expect(addRecentSymbol(' tsla ')).toEqual(['TSLA']);
    expect(addRecentSymbol('aapl')).toEqual(['AAPL', 'TSLA']);
  });

  it('addRecentSymbol ignores empty input', () => {
    addRecentSymbol('TSLA');
    expect(addRecentSymbol('')).toEqual(['TSLA']);
    expect(addRecentSymbol('   ')).toEqual(['TSLA']);
  });

  it('caps at 10 entries', () => {
    for (let i = 0; i < 15; i++) addRecentSymbol(`S${i}`);
    const list = getRecentSymbols();
    expect(list).toHaveLength(10);
    // most recent first
    expect(list[0]).toBe('S14');
    expect(list[9]).toBe('S5');
  });

  it('clearRecentSymbols empties the list', () => {
    addRecentSymbol('TSLA');
    addRecentSymbol('AAPL');
    clearRecentSymbols();
    expect(getRecentSymbols()).toEqual([]);
  });

  it('getRecentSymbols returns [] on corrupt JSON', () => {
    window.localStorage.setItem('hl-options-recent-symbols', '{not json');
    expect(getRecentSymbols()).toEqual([]);
  });

  it('getRecentSymbols filters non-string entries', () => {
    window.localStorage.setItem(
      'hl-options-recent-symbols',
      JSON.stringify(['TSLA', 42, null, 'AAPL']),
    );
    expect(getRecentSymbols()).toEqual(['TSLA', 'AAPL']);
  });
});

import { create } from 'zustand';
import { parseGex, type GexData, type GexDte } from '../services/gex/types.ts';
import { gexTickerFor } from '../services/gex/symbols.ts';

export type GexStrikeMode = 'off' | 'vol' | 'oi';

const SETTINGS_KEY = 'hl-gex';
/** Re-fetch when a reading is older than this; the server caches for 60s on top. */
const FRESH_MS = 55_000;

interface GexSettings {
  levels: boolean;
  strikes: GexStrikeMode;
  dte: GexDte;
  /** Per GEXBot ticker: added to its prices before drawing on the perp. */
  offsets: Record<string, number>;
}

const DEFAULTS: GexSettings = { levels: false, strikes: 'off', dte: 'zero', offsets: {} };

function loadSettings(): GexSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const j = JSON.parse(raw) as Partial<GexSettings>;
    return {
      levels: j.levels === true,
      strikes: j.strikes === 'vol' || j.strikes === 'oi' ? j.strikes : 'off',
      dte: j.dte === 'one' || j.dte === 'full' ? j.dte : 'zero',
      // The offset input left the toolbar; saved offsets are not applied any more.
      offsets: {},
    };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: GexSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

export interface GexStore extends GexSettings {
  /** GEXBot's ticker list; null until loaded. */
  tickers: Set<string> | null;
  /** Latest reading per "TICKER/dte". */
  data: Record<string, GexData>;
  /** Last fetch failure per "TICKER/dte". */
  errors: Record<string, string>;

  setLevels: (on: boolean) => void;
  setStrikes: (mode: GexStrikeMode) => void;
  setDte: (dte: GexDte) => void;
  setOffset: (ticker: string, offset: number) => void;

  /** GEXBot ticker for a chart asset, or null when its options are not on GEXBot. */
  tickerFor: (asset: string) => string | null;
  offsetFor: (ticker: string) => number;
  /** Reading for a ticker at the chosen dte, if one has arrived. */
  current: (ticker: string) => GexData | undefined;

  loadTickers: () => Promise<void>;
  /** Fetch unless the cached reading is still fresh. */
  refresh: (ticker: string) => Promise<void>;
}

const keyOf = (ticker: string, dte: GexDte) => `${ticker}/${dte}`;

let tickersPromise: Promise<void> | null = null;
const inflight = new Map<string, Promise<void>>();

export const useGexStore = create<GexStore>((set, get) => ({
  ...loadSettings(),
  tickers: null,
  data: {},
  errors: {},

  setLevels: (levels) => { set({ levels }); saveSettings(get()); },
  setStrikes: (strikes) => { set({ strikes }); saveSettings(get()); },
  setDte: (dte) => { set({ dte }); saveSettings(get()); },
  setOffset: (ticker, offset) => {
    const offsets = { ...get().offsets };
    if (offset === 0 || !Number.isFinite(offset)) delete offsets[ticker]; else offsets[ticker] = offset;
    set({ offsets });
    saveSettings(get());
  },

  tickerFor: (asset) => gexTickerFor(asset, get().tickers),
  offsetFor: (ticker) => get().offsets[ticker] ?? 0,
  current: (ticker) => get().data[keyOf(ticker, get().dte)],

  loadTickers: () => {
    if (get().tickers) return Promise.resolve();
    if (tickersPromise) return tickersPromise;
    tickersPromise = (async () => {
      try {
        const res = await fetch('/api/gex/tickers');
        const j = (await res.json()) as { stocks?: string[]; indexes?: string[]; futures?: string[] };
        const all = [...(j.stocks ?? []), ...(j.indexes ?? []), ...(j.futures ?? [])];
        if (all.length > 0) set({ tickers: new Set(all) });
      } catch (e) {
        console.warn('[gex] ticker list failed', e);
      } finally {
        tickersPromise = null;
      }
    })();
    return tickersPromise;
  },

  refresh: (ticker) => {
    const dte = get().dte;
    const key = keyOf(ticker, dte);
    const have = get().data[key];
    if (have && Date.now() - have.timestamp < FRESH_MS) return Promise.resolve();
    const running = inflight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const res = await fetch(`/api/gex/${encodeURIComponent(ticker)}/${dte}`);
        const raw: unknown = await res.json();
        const err = (raw as { error?: unknown })?.error;
        if (!res.ok || typeof err === 'string') throw new Error(typeof err === 'string' ? err : `HTTP ${res.status}`);
        const parsed = parseGex(raw, dte);
        set(s => ({ data: { ...s.data, [key]: parsed }, errors: omit(s.errors, key) }));
      } catch (e) {
        set(s => ({ errors: { ...s.errors, [key]: String((e as Error)?.message || e) } }));
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  },
}));

function omit<T extends Record<string, unknown>>(o: T, k: string): T {
  if (!(k in o)) return o;
  const { [k]: _drop, ...rest } = o;
  return rest as T;
}

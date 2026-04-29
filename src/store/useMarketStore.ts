import { create } from 'zustand';
import type { Meta, AssetMeta, AssetCtx, CandleData, CandleInterval } from '../types/market.ts';
import { fetchMetaAndAssetCtxs, fetchCandles, fetchAllMids } from '../services/api/info.ts';

export type AssetCategory = 'perps' | 'xyz';

export interface CategorizedAsset extends AssetMeta {
  category: AssetCategory;
}

export type PaneId = 'primary' | 'secondary';

export interface ChartPane {
  asset: string;
  assetIndex: number;
  interval: CandleInterval;
  candles: CandleData[];
  loading: boolean;
}

interface MarketStore {
  meta: Meta | null;
  xyzMeta: Meta | null;
  assetCtxs: AssetCtx[];
  xyzAssetCtxs: AssetCtx[];
  allMids: Record<string, string>;

  panes: Record<PaneId, ChartPane | undefined>;
  activePaneId: PaneId;
  splitView: boolean;

  /** All assets from both perps and xyz, with category tag */
  allAssets: () => CategorizedAsset[];
  assetCategory: (coin: string) => AssetCategory;
  getPane: (id: PaneId) => ChartPane | undefined;
  getActivePane: () => ChartPane;

  setActivePane: (id: PaneId) => void;
  toggleSplitView: () => void;

  setAsset: (coin: string, paneId?: PaneId) => void;
  setInterval: (interval: CandleInterval, paneId?: PaneId) => void;
  updateMid: (coin: string, mid: string) => void;
  batchUpdateMids: (mids: Record<string, string>) => void;
  appendCandle: (candle: CandleData, interval: CandleInterval) => void;
  loadMeta: () => Promise<void>;
  loadCandles: (paneId?: PaneId) => Promise<void>;
  loadMoreCandles: (paneId?: PaneId) => Promise<void>;
  loadAllMids: () => Promise<void>;
}

const DEFAULT_PANE: ChartPane = {
  asset: 'BTC',
  assetIndex: 0,
  interval: '5m',
  candles: [],
  loading: false,
};

export const useMarketStore = create<MarketStore>((set, get) => ({
  meta: null,
  xyzMeta: null,
  assetCtxs: [],
  xyzAssetCtxs: [],
  allMids: {},

  panes: {
    primary: { ...DEFAULT_PANE },
    secondary: undefined,
  },
  activePaneId: 'primary',
  splitView: false,

  allAssets: () => {
    const perps: CategorizedAsset[] = (get().meta?.universe ?? [])
      .filter(a => !(a as any).isDelisted)
      .map(a => ({ ...a, category: 'perps' as const }));
    const xyz: CategorizedAsset[] = (get().xyzMeta?.universe ?? [])
      .filter(a => !(a as any).isDelisted)
      .map(a => ({ ...a, category: 'xyz' as const }));
    return [...perps, ...xyz];
  },

  assetCategory: (coin: string) => {
    return coin.startsWith('xyz:') ? 'xyz' : 'perps';
  },

  getPane: (id) => get().panes[id],

  getActivePane: () => {
    const { panes, activePaneId } = get();
    return panes[activePaneId] ?? panes.primary!;
  },

  setActivePane: (id) => {
    const pane = get().panes[id];
    if (!pane) return;
    set({ activePaneId: id });
  },

  toggleSplitView: () => set((s) => {
    if (s.splitView) {
      // Closing split view — drop secondary pane, force active back to primary
      return {
        splitView: false,
        activePaneId: 'primary',
        panes: { primary: s.panes.primary, secondary: undefined },
      };
    }
    // Opening split view — seed secondary from primary if not already present
    const seed: ChartPane = s.panes.secondary ?? {
      ...DEFAULT_PANE,
      asset: s.panes.primary?.asset === 'ETH' ? 'BTC' : 'ETH',
      interval: s.panes.primary?.interval ?? '5m',
    };
    const all = get().allAssets();
    const idx = all.findIndex(a => a.name === seed.asset);
    return {
      splitView: true,
      panes: {
        primary: s.panes.primary,
        secondary: { ...seed, assetIndex: idx >= 0 ? idx : 0, candles: [] },
      },
    };
  }),

  setAsset: (coin, paneId) => {
    const id = paneId ?? get().activePaneId;
    const all = get().allAssets();
    const idx = all.findIndex(a => a.name === coin);
    set((s) => {
      const existing = s.panes[id];
      if (!existing) return s;
      return {
        panes: {
          ...s.panes,
          [id]: { ...existing, asset: coin, assetIndex: idx >= 0 ? idx : 0, candles: [] },
        },
      };
    });
  },

  setInterval: (interval, paneId) => {
    const id = paneId ?? get().activePaneId;
    set((s) => {
      const existing = s.panes[id];
      if (!existing) return s;
      return {
        panes: {
          ...s.panes,
          [id]: { ...existing, interval, candles: [] },
        },
      };
    });
  },

  updateMid: (coin, mid) => {
    get().allMids[coin] = mid;
  },

  batchUpdateMids: (mids: Record<string, string>) => set((s) => ({
    allMids: { ...s.allMids, ...mids },
  })),

  appendCandle: (candle, interval) => set((s) => {
    const next = { ...s.panes };
    let changed = false;
    for (const id of ['primary', 'secondary'] as PaneId[]) {
      const pane = next[id];
      if (!pane) continue;
      if (pane.asset !== candle.s || pane.interval !== interval) continue;
      const candles = [...pane.candles];
      const last = candles[candles.length - 1];
      if (last && last.t === candle.t) {
        candles[candles.length - 1] = candle;
      } else {
        candles.push(candle);
      }
      next[id] = { ...pane, candles };
      changed = true;
    }
    return changed ? { panes: next } : s;
  }),

  loadMeta: async () => {
    const [perpResults, xyzResults] = await Promise.all([
      fetchMetaAndAssetCtxs(),
      fetchMetaAndAssetCtxs('xyz').catch(() => [{ universe: [] }, []] as [Meta, AssetCtx[]]),
    ]);
    const [meta, assetCtxs] = perpResults;
    const [xyzMeta, xyzAssetCtxs] = xyzResults;
    set((s) => {
      const next = { ...s.panes };
      for (const id of ['primary', 'secondary'] as PaneId[]) {
        const pane = next[id];
        if (!pane) continue;
        const idx = meta.universe.findIndex(a => a.name === pane.asset);
        next[id] = { ...pane, assetIndex: idx >= 0 ? idx : 0 };
      }
      return { meta, assetCtxs, xyzMeta, xyzAssetCtxs, panes: next };
    });
  },

  loadCandles: async (paneId) => {
    const id = paneId ?? get().activePaneId;
    const pane = get().panes[id];
    if (!pane) return;
    const { asset, interval } = pane;
    set((s) => {
      const existing = s.panes[id];
      if (!existing) return s;
      return { panes: { ...s.panes, [id]: { ...existing, loading: true } } };
    });
    const now = Date.now();
    const intervalMs = intervalToMs(interval);
    const startTime = now - intervalMs * 300;
    const candles = await fetchCandles(asset, interval, startTime, now);
    // Only apply if still on the same asset/interval (user may have switched mid-fetch)
    set((s) => {
      const cur = s.panes[id];
      if (!cur || cur.asset !== asset || cur.interval !== interval) return s;
      return { panes: { ...s.panes, [id]: { ...cur, candles, loading: false } } };
    });
  },

  loadMoreCandles: async (paneId) => {
    const id = paneId ?? get().activePaneId;
    const pane = get().panes[id];
    if (!pane) return;
    const { asset, interval, candles, loading } = pane;
    if (loading || candles.length === 0) return;
    set((s) => {
      const existing = s.panes[id];
      if (!existing) return s;
      return { panes: { ...s.panes, [id]: { ...existing, loading: true } } };
    });
    const intervalMs = intervalToMs(interval);
    const earliest = Math.min(...candles.map(c => c.t));
    const startTime = earliest - intervalMs * 300;
    const older = await fetchCandles(asset, interval, startTime, earliest);
    set((s) => {
      const cur = s.panes[id];
      if (!cur || cur.asset !== asset || cur.interval !== interval) return s;
      return { panes: { ...s.panes, [id]: { ...cur, candles: [...older, ...cur.candles], loading: false } } };
    });
  },

  loadAllMids: async () => {
    const [perpMids, xyzMids] = await Promise.all([
      fetchAllMids(),
      fetchAllMids('xyz').catch(() => ({} as Record<string, string>)),
    ]);
    set({ allMids: { ...perpMids, ...xyzMids } });
  },
}));

function intervalToMs(interval: CandleInterval): number {
  const map: Record<string, number> = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000,
    '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 2_592_000_000,
  };
  return map[interval] ?? 300_000;
}

import { create } from 'zustand';
import type { Meta, AssetMeta, AssetCtx, CandleData, CandleInterval } from '../types/market.ts';
import { fetchMetaAndAssetCtxs, fetchCandles, fetchAllMids } from '../services/api/info.ts';

export type AssetCategory = 'perps' | 'xyz';

export interface CategorizedAsset extends AssetMeta {
  category: AssetCategory;
}

interface MarketStore {
  meta: Meta | null;
  xyzMeta: Meta | null;
  assetCtxs: AssetCtx[];
  xyzAssetCtxs: AssetCtx[];
  currentAsset: string;
  currentAssetIndex: number;
  allMids: Record<string, string>;
  candles: CandleData[];
  interval: CandleInterval;
  loading: boolean;

  /** All assets from both perps and xyz, with category tag */
  allAssets: () => CategorizedAsset[];
  assetCategory: (coin: string) => AssetCategory;

  setAsset: (coin: string) => void;
  setInterval: (interval: CandleInterval) => void;
  updateMid: (coin: string, mid: string) => void;
  batchUpdateMids: (mids: Record<string, string>) => void;
  appendCandle: (candle: CandleData) => void;
  setCandles: (candles: CandleData[]) => void;
  loadMeta: () => Promise<void>;
  loadCandles: () => Promise<void>;
  loadAllMids: () => Promise<void>;
}

export const useMarketStore = create<MarketStore>((set, get) => ({
  meta: null,
  xyzMeta: null,
  assetCtxs: [],
  xyzAssetCtxs: [],
  currentAsset: 'BTC',
  currentAssetIndex: 0,
  allMids: {},
  candles: [],
  interval: '5m',
  loading: false,

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

  setAsset: (coin: string) => {
    const all = get().allAssets();
    const idx = all.findIndex(a => a.name === coin);
    set({ currentAsset: coin, currentAssetIndex: idx >= 0 ? idx : 0, candles: [] });
  },

  setInterval: (interval) => set({ interval, candles: [] }),

  updateMid: (coin, mid) => {
    get().allMids[coin] = mid;
  },

  batchUpdateMids: (mids: Record<string, string>) => set((s) => ({
    allMids: { ...s.allMids, ...mids },
  })),

  appendCandle: (candle) => set((s) => {
    // Ignore candles for a different asset
    if (candle.s !== s.currentAsset) return s;
    const candles = [...s.candles];
    const last = candles[candles.length - 1];
    if (last && last.t === candle.t) {
      candles[candles.length - 1] = candle;
    } else {
      candles.push(candle);
    }
    return { candles };
  }),

  setCandles: (candles) => set({ candles }),

  loadMeta: async () => {
    const [perpResults, xyzResults] = await Promise.all([
      fetchMetaAndAssetCtxs(),
      fetchMetaAndAssetCtxs('xyz').catch(() => [{ universe: [] }, []] as [Meta, AssetCtx[]]),
    ]);
    const [meta, assetCtxs] = perpResults;
    const [xyzMeta, xyzAssetCtxs] = xyzResults;
    const idx = meta.universe.findIndex(a => a.name === get().currentAsset);
    set({ meta, assetCtxs, xyzMeta, xyzAssetCtxs, currentAssetIndex: idx >= 0 ? idx : 0 });
  },

  loadCandles: async () => {
    const { currentAsset, interval } = get();
    set({ loading: true });
    const now = Date.now();
    const intervalMs = intervalToMs(interval);
    const startTime = now - intervalMs * 300;
    const candles = await fetchCandles(currentAsset, interval, startTime, now);
    // Only apply if we're still on the same asset (user may have switched during fetch)
    if (get().currentAsset === currentAsset) {
      set({ candles, loading: false });
    }
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

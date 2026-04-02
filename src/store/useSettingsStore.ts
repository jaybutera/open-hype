import { create } from 'zustand';
import { DEFAULT_LEVERAGE } from '../config/constants.ts';
import type { Side } from '../types/order.ts';

const FAVORITES_KEY = 'hl-favorites';
const RISK_KEY = 'hl-risk-usdc';

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFavorites(favs: string[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

function loadRisk(): string {
  try {
    return localStorage.getItem(RISK_KEY) ?? '';
  } catch { return ''; }
}

function saveRisk(v: string) {
  try { localStorage.setItem(RISK_KEY, v); } catch {}
}

interface SettingsStore {
  mode: 'paper' | 'live';
  leverage: number;
  defaultTif: 'Gtc' | 'Ioc' | 'Alo';
  sizeUsdc: string;
  riskUsdc: string;
  side: Side;
  favorites: string[];
  setMode: (m: 'paper' | 'live') => void;
  setLeverage: (l: number) => void;
  setDefaultTif: (t: 'Gtc' | 'Ioc' | 'Alo') => void;
  setSizeUsdc: (s: string) => void;
  setRiskUsdc: (s: string) => void;
  setSide: (s: Side) => void;
  toggleFavorite: (coin: string) => void;
  isFavorite: (coin: string) => boolean;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  mode: 'paper',
  leverage: DEFAULT_LEVERAGE,
  defaultTif: 'Gtc',
  sizeUsdc: '',
  riskUsdc: loadRisk(),
  side: 'buy',
  favorites: loadFavorites(),
  setMode: (mode) => set({ mode }),
  setLeverage: (leverage) => set({ leverage }),
  setDefaultTif: (defaultTif) => set({ defaultTif }),
  setSizeUsdc: (sizeUsdc) => set({ sizeUsdc }),
  setRiskUsdc: (riskUsdc) => { saveRisk(riskUsdc); set({ riskUsdc }); },
  setSide: (side) => set({ side }),
  toggleFavorite: (coin) => {
    const favs = get().favorites;
    const next = favs.includes(coin)
      ? favs.filter(f => f !== coin)
      : [...favs, coin];
    saveFavorites(next);
    set({ favorites: next });
  },
  isFavorite: (coin) => get().favorites.includes(coin),
}));

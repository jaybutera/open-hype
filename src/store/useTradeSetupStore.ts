import { create } from 'zustand';
import type { Side } from '../types/order.ts';
import { useSettingsStore } from './useSettingsStore.ts';

export interface TradeSetup {
  id: string;
  side: Side;
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  assetSize: number;
  riskUsdc: number;
  potentialPnl: number;
  potentialLoss: number;
  rr: number;
}

interface PendingSetup {
  side: Side;
  clicks: number[];
}

interface TradeSetupStore {
  activeSetups: TradeSetup[];
  pendingSetup: PendingSetup | null;
  startSetup: (side: Side) => void;
  addClick: (price: number) => TradeSetup | null;
  updateSetup: (id: string, field: 'entry' | 'sl' | 'tp', price: number) => void;
  removeSetup: (id: string) => void;
  clearPending: () => void;
}

function resolveClicks(side: Side, clicks: number[]): { entry: number; sl: number; tp: number } {
  const sorted = [...clicks].sort((a, b) => a - b);
  if (side === 'buy') {
    // Long: lowest = SL, middle = entry, highest = TP
    return { sl: sorted[0], entry: sorted[1], tp: sorted[2] };
  }
  // Short: lowest = TP, middle = entry, highest = SL
  return { tp: sorted[0], entry: sorted[1], sl: sorted[2] };
}

function calcSetup(side: Side, entry: number, sl: number, tp: number, riskUsdc: number): TradeSetup {
  const riskPerUnit = Math.abs(entry - sl);
  const assetSize = riskPerUnit > 0 ? riskUsdc / riskPerUnit : 0;
  const potentialPnl = assetSize * Math.abs(tp - entry);
  const potentialLoss = riskUsdc;
  const rr = riskPerUnit > 0 ? Math.abs(tp - entry) / riskPerUnit : 0;

  return {
    id: crypto.randomUUID(),
    side,
    entryPrice: entry,
    slPrice: sl,
    tpPrice: tp,
    assetSize,
    riskUsdc,
    potentialPnl,
    potentialLoss,
    rr,
  };
}

function recalc(setup: TradeSetup): TradeSetup {
  const { side, entryPrice, slPrice, tpPrice, riskUsdc } = setup;
  const riskPerUnit = Math.abs(entryPrice - slPrice);
  const assetSize = riskPerUnit > 0 ? riskUsdc / riskPerUnit : 0;
  const potentialPnl = assetSize * Math.abs(tpPrice - entryPrice);
  const rr = riskPerUnit > 0 ? Math.abs(tpPrice - entryPrice) / riskPerUnit : 0;
  return { ...setup, assetSize, potentialPnl, potentialLoss: riskUsdc, rr };
}

export const useTradeSetupStore = create<TradeSetupStore>((set, get) => ({
  activeSetups: [],
  pendingSetup: null,

  startSetup: (side) => set({ pendingSetup: { side, clicks: [] } }),

  addClick: (price) => {
    const pending = get().pendingSetup;
    if (!pending) return null;

    const clicks = [...pending.clicks, price];
    if (clicks.length < 3) {
      set({ pendingSetup: { ...pending, clicks } });
      return null;
    }

    // 3 clicks collected — resolve and create setup
    const { entry, sl, tp } = resolveClicks(pending.side, clicks);
    const riskUsdc = parseFloat(useSettingsStore.getState().riskUsdc) || 0;
    const setup = calcSetup(pending.side, entry, sl, tp, riskUsdc);

    set(s => ({
      pendingSetup: null,
      activeSetups: [...s.activeSetups, setup],
    }));
    return setup;
  },

  updateSetup: (id, field, price) => {
    set(s => ({
      activeSetups: s.activeSetups.map(setup => {
        if (setup.id !== id) return setup;
        const updated = { ...setup };
        if (field === 'entry') updated.entryPrice = price;
        else if (field === 'sl') updated.slPrice = price;
        else if (field === 'tp') updated.tpPrice = price;
        return recalc(updated);
      }),
    }));
  },

  removeSetup: (id) => {
    set(s => ({ activeSetups: s.activeSetups.filter(setup => setup.id !== id) }));
  },

  clearPending: () => set({ pendingSetup: null }),
}));

// Recompute all active setups when riskUsdc changes
let _prevRisk = useSettingsStore.getState().riskUsdc;
useSettingsStore.subscribe((state) => {
  if (state.riskUsdc === _prevRisk) return;
  _prevRisk = state.riskUsdc;
  const risk = parseFloat(state.riskUsdc) || 0;
  const { activeSetups } = useTradeSetupStore.getState();
  if (activeSetups.length === 0) return;
  useTradeSetupStore.setState({
    activeSetups: activeSetups.map(s => recalc({ ...s, riskUsdc: risk })),
  });
});

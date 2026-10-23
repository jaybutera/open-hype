import { create } from 'zustand';
import type { Side } from '../types/order.ts';
import { useSettingsStore } from './useSettingsStore.ts';
import { useMarketStore, type PaneId } from './useMarketStore.ts';
import { newId } from '../utils/id.ts';

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
  /** Pane the setup was drawn on — controls which chart renders the box */
  paneId: PaneId;
  /** Asset snapshotted at draw-time — execution targets this regardless of active pane */
  asset: string;
  /** Bar time (s) of the first click; the box starts here. */
  startTime?: number;
}

interface PendingSetup {
  side: Side;
  clicks: number[];
  paneId: PaneId;
  asset: string;
  startTime?: number;
}

interface TradeSetupStore {
  activeSetups: TradeSetup[];
  pendingSetup: PendingSetup | null;
  startSetup: (side: Side) => void;
  /** A click on another pane than the pending setup's restarts it there, on that pane's asset. */
  addClick: (price: number, time?: number | null, at?: { paneId: PaneId; asset: string }) => TradeSetup | null;
  updateSetup: (id: string, field: 'entry' | 'sl' | 'tp', price: number) => void;
  removeSetup: (id: string) => void;
  clearPending: () => void;
  /** Execute request from the chart's trade box; an OrderPanel takes it and runs it. */
  executeRequest: { id: string; nonce: number } | null;
  requestExecute: (id: string) => void;
  /** Returns and clears the pending request, so exactly one taker runs it. */
  takeExecuteRequest: () => { id: string; nonce: number } | null;
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

function calcSetup(side: Side, entry: number, sl: number, tp: number, riskUsdc: number, paneId: PaneId, asset: string, startTime?: number): TradeSetup {
  const riskPerUnit = Math.abs(entry - sl);
  const assetSize = riskPerUnit > 0 ? riskUsdc / riskPerUnit : 0;
  const potentialPnl = assetSize * Math.abs(tp - entry);
  const potentialLoss = riskUsdc;
  const rr = riskPerUnit > 0 ? Math.abs(tp - entry) / riskPerUnit : 0;

  return {
    id: newId(),
    side,
    entryPrice: entry,
    slPrice: sl,
    tpPrice: tp,
    assetSize,
    riskUsdc,
    potentialPnl,
    potentialLoss,
    rr,
    paneId,
    asset,
    ...(startTime !== undefined ? { startTime } : {}),
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

  startSetup: (side) => {
    const market = useMarketStore.getState();
    const paneId = market.activePaneId;
    const pane = market.panes[paneId] ?? market.panes.primary!;
    set({ pendingSetup: { side, clicks: [], paneId, asset: pane.asset } });
  },

  addClick: (price, time, at) => {
    let pending = get().pendingSetup;
    if (!pending) return null;
    if (at && (at.paneId !== pending.paneId || at.asset !== pending.asset)) {
      pending = { side: pending.side, clicks: [], paneId: at.paneId, asset: at.asset };
    }
    if (pending.clicks.length === 0 && time != null) pending = { ...pending, startTime: time };

    const clicks = [...pending.clicks, price];
    if (clicks.length < 3) {
      set({ pendingSetup: { ...pending, clicks } });
      return null;
    }

    // 3 clicks collected — resolve and create setup, frozen to the originating pane/asset
    const { entry, sl, tp } = resolveClicks(pending.side, clicks);
    const riskUsdc = parseFloat(useSettingsStore.getState().riskUsdc) || 0;
    const setup = calcSetup(pending.side, entry, sl, tp, riskUsdc, pending.paneId, pending.asset, pending.startTime);

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

  executeRequest: null,
  requestExecute: (id) => set(s => ({ executeRequest: { id, nonce: (s.executeRequest?.nonce ?? 0) + 1 } })),
  takeExecuteRequest: () => {
    const req = get().executeRequest;
    if (req) set({ executeRequest: null });
    return req;
  },
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

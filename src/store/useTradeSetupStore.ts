import { create } from 'zustand';
import type { Side } from '../types/order.ts';
import { useSettingsStore } from './useSettingsStore.ts';
import { useMarketStore, type PaneId } from './useMarketStore.ts';
import { newId } from '../utils/id.ts';

/** One take-profit leg: closes `pct` percent of the setup's size at `price`. */
export interface TakeProfit {
  id: string;
  price: number;
  /** Whole percent of the position this leg closes; the legs sum to 100. */
  pct: number;
}

/** Most TP legs one setup holds. */
export const MAX_TPS = 5;
/** Step for scrolling a TP's share, and the smallest share a leg keeps. */
export const TP_PCT_STEP = 5;

/** Drag target on the box: entry, SL, TP1 ('tp'), or a TP leg by id. */
export type SetupField = 'entry' | 'sl' | 'tp' | `tp:${string}`;

export interface TradeSetup {
  id: string;
  side: Side;
  entryPrice: number;
  slPrice: number;
  /** TP1, the nearest leg to entry; mirrors tps[0].price. */
  tpPrice: number;
  /** Take-profit legs, nearest to entry first. One leg closes 100%. */
  tps: TakeProfit[];
  assetSize: number;
  riskUsdc: number;
  /** P&L if every TP fills, each on its share of the size. */
  potentialPnl: number;
  potentialLoss: number;
  /** R if every TP fills, weighted by share. */
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
  /** The first click is the entry (shift+click start); later clicks are SL or TPs by which side of entry they land on. */
  entryFirst?: boolean;
}

interface TradeSetupStore {
  activeSetups: TradeSetup[];
  pendingSetup: PendingSetup | null;
  startSetup: (side: Side) => void;
  /** Start a setup with the entry already placed at `price` on the clicked pane; more clicks give SL and TPs. */
  startSetupAt: (side: Side, price: number, time: number | null | undefined, at: { paneId: PaneId; asset: string }) => void;
  /**
   * Add a click to the pending setup. A plain click finishes it once it has an entry, an SL and a TP;
   * `more` (ctrl+click) adds the point and keeps it open for further TPs.
   * A click on another pane than the pending setup's restarts it there, on that pane's asset.
   */
  addClick: (price: number, time?: number | null, at?: { paneId: PaneId; asset: string }, more?: boolean) => TradeSetup | null;
  /** Finish the pending setup with the clicks so far (Enter); null when it lacks an SL or a TP. */
  finishPending: () => TradeSetup | null;
  updateSetup: (id: string, field: SetupField, price: number) => void;
  removeSetup: (id: string) => void;
  clearPending: () => void;
  /** Setup waiting for a chart click to add a TP leg (the box's +TP button). */
  addingTpTo: string | null;
  startAddTp: (id: string) => void;
  cancelAddTp: () => void;
  /** Add a TP leg at `price`; false when it is on the loss side or the setup has MAX_TPS. Shares reset to even. */
  addTp: (id: string, price: number) => boolean;
  /** Remove a TP leg; the last one stays. Shares reset to even. */
  removeTp: (id: string, tpId: string) => void;
  /** Move a leg's share by `delta` percent, taken from or given to the farthest other leg. */
  nudgeTpPct: (id: string, tpId: string, delta: number) => void;
  /** Execute request from the chart's trade box; an OrderPanel takes it and runs it. */
  executeRequest: { id: string; nonce: number } | null;
  requestExecute: (id: string) => void;
  /** Returns and clears the pending request, so exactly one taker runs it. */
  takeExecuteRequest: () => { id: string; nonce: number } | null;
  /** Result of the last setup Execute, shown on the chart since the order panel may be hidden. */
  executeOutcome: { ok: boolean; message: string; at: number } | null;
  setExecuteOutcome: (ok: boolean, message: string) => void;
}

/** Even whole-percent split; the last leg takes the remainder. */
export function evenSplit(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - base * (n - 1) : base));
}

/** True when `price` is on the profit side of `entry`. */
function profitSide(side: Side, entry: number, price: number): boolean {
  return side === 'buy' ? price > entry : price < entry;
}

/** Legs sorted nearest to entry first. */
function sortTps(side: Side, tps: TakeProfit[]): TakeProfit[] {
  return [...tps].sort((a, b) => (side === 'buy' ? a.price - b.price : b.price - a.price));
}

function withEvenSplit(tps: TakeProfit[]): TakeProfit[] {
  const pcts = evenSplit(tps.length);
  return tps.map((t, i) => ({ ...t, pct: pcts[i] }));
}

/**
 * Entry, SL and TPs from the clicks, whatever order they came in; null until there is an SL and a TP.
 * Entry first: later clicks on the loss side are the SL (the last one wins), on the profit side TPs.
 * Otherwise, sorted from the stop side: SL, entry, then the TPs.
 */
export function resolveClicks(side: Side, clicks: number[], entryFirst?: boolean): { entry: number; sl: number; tps: number[] } | null {
  if (entryFirst) {
    const [entry, ...rest] = clicks;
    if (entry === undefined) return null;
    const sl = rest.filter(c => c !== entry && !profitSide(side, entry, c)).pop();
    const tps = [...new Set(rest.filter(c => profitSide(side, entry, c)))]
      .sort((a, b) => Math.abs(a - entry) - Math.abs(b - entry))
      .slice(0, MAX_TPS);
    return sl === undefined || tps.length === 0 ? null : { entry, sl, tps };
  }
  if (clicks.length < 3) return null;
  // Long: lowest = SL, next = entry, the rest TPs going up. Short mirrors from the top.
  const sorted = [...clicks].sort((a, b) => (side === 'buy' ? a - b : b - a));
  return { sl: sorted[0], entry: sorted[1], tps: [...new Set(sorted.slice(2))].slice(0, MAX_TPS) };
}

function calcSetup(side: Side, entry: number, sl: number, tpPrices: number[], riskUsdc: number, paneId: PaneId, asset: string, startTime?: number): TradeSetup {
  const tps = withEvenSplit(tpPrices.map(price => ({ id: newId(), price, pct: 0 })));
  return recalc({
    id: newId(),
    side,
    entryPrice: entry,
    slPrice: sl,
    tpPrice: tpPrices[0],
    tps,
    assetSize: 0,
    riskUsdc,
    potentialPnl: 0,
    potentialLoss: riskUsdc,
    rr: 0,
    paneId,
    asset,
    ...(startTime !== undefined ? { startTime } : {}),
  });
}

function recalc(setup: TradeSetup): TradeSetup {
  const { side, entryPrice, slPrice, riskUsdc } = setup;
  const tps = sortTps(side, setup.tps);
  const riskPerUnit = Math.abs(entryPrice - slPrice);
  const assetSize = riskPerUnit > 0 ? riskUsdc / riskPerUnit : 0;
  let potentialPnl = 0;
  let rr = 0;
  for (const t of tps) {
    const move = Math.abs(t.price - entryPrice);
    potentialPnl += assetSize * (t.pct / 100) * move;
    if (riskPerUnit > 0) rr += (t.pct / 100) * (move / riskPerUnit);
  }
  return { ...setup, tps, tpPrice: tps[0].price, assetSize, potentialPnl, potentialLoss: riskUsdc, rr };
}

/** Size each TP leg closes; the last leg takes what rounding leaves so the legs add up to `size`. */
export function tpLegSizes(tps: TakeProfit[], size: number): number[] {
  let used = 0;
  return tps.map((t, i) => {
    if (i === tps.length - 1) return size - used;
    const s = (size * t.pct) / 100;
    used += s;
    return s;
  });
}

export const useTradeSetupStore = create<TradeSetupStore>((set, get) => ({
  activeSetups: [],
  pendingSetup: null,

  startSetup: (side) => {
    const market = useMarketStore.getState();
    const paneId = market.activePaneId;
    const pane = market.panes[paneId] ?? market.panes.primary!;
    set({ pendingSetup: { side, clicks: [], paneId, asset: pane.asset }, addingTpTo: null });
  },

  startSetupAt: (side, price, time, at) => {
    set({
      pendingSetup: {
        side,
        clicks: [price],
        paneId: at.paneId,
        asset: at.asset,
        entryFirst: true,
        ...(time != null ? { startTime: time } : {}),
      },
      addingTpTo: null,
    });
  },

  addClick: (price, time, at, more) => {
    let pending = get().pendingSetup;
    if (!pending) return null;
    if (at && (at.paneId !== pending.paneId || at.asset !== pending.asset)) {
      // A fixed entry belongs to the pane it was clicked on; a restart elsewhere collects all the clicks again.
      pending = { side: pending.side, clicks: [], paneId: at.paneId, asset: at.asset };
    }
    if (pending.clicks.length === 0 && time != null) pending = { ...pending, startTime: time };

    let clicks = [...pending.clicks, price];
    if (pending.entryFirst && clicks.length > 1) {
      // A new loss-side click moves the SL, so the markers show the one that counts.
      const entry = clicks[0];
      if (!profitSide(pending.side, entry, price)) {
        clicks = [entry, ...pending.clicks.slice(1).filter(c => profitSide(pending.side, entry, c)), price];
      }
    }
    set({ pendingSetup: { ...pending, clicks } });
    return more ? null : get().finishPending();
  },

  finishPending: () => {
    const pending = get().pendingSetup;
    if (!pending) return null;
    const r = resolveClicks(pending.side, pending.clicks, pending.entryFirst);
    if (!r) return null;
    const riskUsdc = parseFloat(useSettingsStore.getState().riskUsdc) || 0;
    const setup = calcSetup(pending.side, r.entry, r.sl, r.tps, riskUsdc, pending.paneId, pending.asset, pending.startTime);
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
        else {
          const tpId = field === 'tp' ? setup.tps[0].id : field.slice(3);
          updated.tps = setup.tps.map(t => (t.id === tpId ? { ...t, price } : t));
        }
        return recalc(updated);
      }),
    }));
  },

  addingTpTo: null,
  startAddTp: (id) => set({ addingTpTo: id, pendingSetup: null }),
  cancelAddTp: () => set({ addingTpTo: null }),

  addTp: (id, price) => {
    const setup = get().activeSetups.find(s => s.id === id);
    set({ addingTpTo: null });
    if (!setup || setup.tps.length >= MAX_TPS || !profitSide(setup.side, setup.entryPrice, price)) return false;
    if (setup.tps.some(t => t.price === price)) return false;
    const tps = withEvenSplit(sortTps(setup.side, [...setup.tps, { id: newId(), price, pct: 0 }]));
    set(s => ({ activeSetups: s.activeSetups.map(x => (x.id === id ? recalc({ ...x, tps }) : x)) }));
    return true;
  },

  removeTp: (id, tpId) => {
    set(s => ({
      activeSetups: s.activeSetups.map(x => {
        if (x.id !== id || x.tps.length <= 1) return x;
        return recalc({ ...x, tps: withEvenSplit(x.tps.filter(t => t.id !== tpId)) });
      }),
    }));
  },

  nudgeTpPct: (id, tpId, delta) => {
    set(s => ({
      activeSetups: s.activeSetups.map(x => {
        if (x.id !== id || x.tps.length < 2) return x;
        const target = x.tps.find(t => t.id === tpId);
        const donor = [...x.tps].reverse().find(t => t.id !== tpId);
        if (!target || !donor) return x;
        const lo = TP_PCT_STEP - target.pct;
        const hi = donor.pct - TP_PCT_STEP;
        const d = Math.max(lo, Math.min(hi, delta));
        if (d === 0) return x;
        return recalc({
          ...x,
          tps: x.tps.map(t => (t.id === target.id ? { ...t, pct: t.pct + d } : t.id === donor.id ? { ...t, pct: t.pct - d } : t)),
        });
      }),
    }));
  },

  removeSetup: (id) => {
    set(s => ({ activeSetups: s.activeSetups.filter(setup => setup.id !== id), addingTpTo: s.addingTpTo === id ? null : s.addingTpTo }));
  },

  clearPending: () => set({ pendingSetup: null }),

  executeRequest: null,
  requestExecute: (id) => set(s => ({ executeRequest: { id, nonce: (s.executeRequest?.nonce ?? 0) + 1 } })),
  takeExecuteRequest: () => {
    const req = get().executeRequest;
    if (req) set({ executeRequest: null });
    return req;
  },

  executeOutcome: null,
  setExecuteOutcome: (ok, message) => set({ executeOutcome: { ok, message, at: Date.now() } }),
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

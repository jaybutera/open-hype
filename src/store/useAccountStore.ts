import { create } from 'zustand';
import type { PaperPosition } from '../engine/paper/positions.ts';
import type { PaperOrder } from '../engine/paper/matching.ts';
import type { LedgerEntry } from '../engine/paper/ledger.ts';
import type { Position, ClearinghouseState } from '../types/position.ts';
import type { OpenOrder } from '../types/order.ts';

interface AccountStore {
  // Live mode
  positions: Position[];
  openOrders: OpenOrder[];
  clearinghouseState: ClearinghouseState | null;
  updateLiveState: (state: ClearinghouseState) => void;
  setLiveOrders: (orders: OpenOrder[]) => void;

  // Paper mode
  paperBalance: string;
  paperPositions: PaperPosition[];
  paperOrders: PaperOrder[];
  paperFills: LedgerEntry[];
  updatePaperState: (state: {
    balance: string;
    positions: PaperPosition[];
    openOrders: PaperOrder[];
    fills: LedgerEntry[];
  }) => void;
}

export const useAccountStore = create<AccountStore>((set) => ({
  // Live
  positions: [],
  openOrders: [],
  clearinghouseState: null,
  updateLiveState: (state) => set({
    clearinghouseState: state,
    positions: state.assetPositions.map(ap => ap.position),
  }),
  setLiveOrders: (orders) => set({ openOrders: orders }),

  // Paper
  paperBalance: '10000',
  paperPositions: [],
  paperOrders: [],
  paperFills: [],
  updatePaperState: (state) => set({
    paperBalance: state.balance,
    paperPositions: state.positions,
    paperOrders: state.openOrders,
    paperFills: state.fills,
  }),
}));

import { create } from 'zustand';
import type { Side, TpSl } from '../types/order.ts';

export type DraftOrderType = 'limit' | 'stop' | 'tp';

export interface DraftOrder {
  side: Side;
  type: DraftOrderType;
  price: number;
  tpsl?: TpSl;
}

interface ChartStore {
  isDragging: boolean;
  draftOrder: DraftOrder | null;
  showConfirm: boolean;
  setDraftOrder: (draft: DraftOrder | null) => void;
  setDragging: (v: boolean) => void;
  setShowConfirm: (v: boolean) => void;
  clearDraft: () => void;
}

export const useChartStore = create<ChartStore>((set) => ({
  isDragging: false,
  draftOrder: null,
  showConfirm: false,
  setDraftOrder: (draftOrder) => set({ draftOrder }),
  setDragging: (isDragging) => set({ isDragging }),
  setShowConfirm: (showConfirm) => set({ showConfirm }),
  clearDraft: () => set({ draftOrder: null, isDragging: false, showConfirm: false }),
}));

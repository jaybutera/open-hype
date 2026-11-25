import { create } from 'zustand';
import type { StrategySignal } from '../services/signals/book.ts';

interface SignalStore {
  /** Signals pushed to the dev server's /api/signals, newest first. */
  signals: StrategySignal[];
  /** Signals drawn on the chart. Nothing is drawn until a card is clicked. */
  enabledIds: string[];
  /** Signals that arrived while the page was open and have not been clicked yet. */
  unseenIds: string[];
  /** Replace the list from the server. Ids that were not there before count as unseen, except on the first list. */
  receive: (signals: StrategySignal[]) => void;
  toggle: (id: string) => void;
  /** Remove one signal here and on the server. */
  dismiss: (id: string) => void;
  clearAll: () => void;
}

let loaded = false;

function deleteOnServer(id?: string) {
  if (typeof fetch !== 'function') return;
  fetch(id ? `/api/signals?id=${encodeURIComponent(id)}` : '/api/signals', { method: 'DELETE' }).catch(() => {});
}

export const useSignalStore = create<SignalStore>((set, get) => ({
  signals: [],
  enabledIds: [],
  unseenIds: [],

  receive: (signals) => {
    const ids = new Set(signals.map(s => s.id));
    const first = !loaded;
    loaded = true;
    set(s => {
      const known = new Set(s.signals.map(x => x.id));
      const fresh = first ? [] : signals.filter(x => !known.has(x.id)).map(x => x.id);
      return {
        signals,
        enabledIds: s.enabledIds.filter(id => ids.has(id)),
        unseenIds: [...s.unseenIds.filter(id => ids.has(id)), ...fresh],
      };
    });
  },

  toggle: (id) => {
    const { signals, enabledIds, unseenIds } = get();
    if (!signals.some(s => s.id === id)) return;
    set({
      enabledIds: enabledIds.includes(id) ? enabledIds.filter(x => x !== id) : [...enabledIds, id],
      unseenIds: unseenIds.filter(x => x !== id),
    });
  },

  dismiss: (id) => {
    set(s => ({
      signals: s.signals.filter(x => x.id !== id),
      enabledIds: s.enabledIds.filter(x => x !== id),
      unseenIds: s.unseenIds.filter(x => x !== id),
    }));
    deleteOnServer(id);
  },

  clearAll: () => {
    set({ signals: [], enabledIds: [], unseenIds: [] });
    deleteOnServer();
  },
}));

/** Tests only: forget that a first list was received. */
export function resetSignalStoreForTest() {
  loaded = false;
  useSignalStore.setState({ signals: [], enabledIds: [], unseenIds: [] });
}

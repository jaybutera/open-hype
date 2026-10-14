import { create } from 'zustand';
import type { Alert, AlertInput } from '../services/ai/alerts.ts';

interface AlertStore {
  /** Alerts known to the dev server, armed and fired. */
  alerts: Alert[];
  /** Last error from an add, shown briefly in the panel. */
  error: string | null;
  receive: (alerts: Alert[]) => void;
  /** Arm an alert on the server; the list comes back over the AI link. */
  add: (input: AlertInput) => Promise<void>;
  /** Remove one alert (armed or fired) locally and on the server. */
  remove: (id: string) => void;
}

export const useAlertStore = create<AlertStore>((set, get) => ({
  alerts: [],
  error: null,

  receive: (alerts) => set({ alerts }),

  add: async (input) => {
    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch('/api/ai/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, source: 'ui' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { set({ error: body.error ?? `alert rejected (${res.status})` }); return; }
      set({ error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  remove: (id) => {
    set({ alerts: get().alerts.filter(a => a.id !== id) });
    if (typeof fetch !== 'function') return;
    fetch(`/api/ai/alerts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  },
}));

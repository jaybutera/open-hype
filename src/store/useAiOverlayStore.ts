import { create } from 'zustand';
import type { OverlaySet } from '../services/ai/types.ts';

interface AiOverlayStore {
  /** Overlay sets pushed by the AI, in push order. */
  sets: OverlaySet[];
  /** Sets the user toggled on. Nothing is drawn until a set is in here. */
  enabledIds: string[];
  /** True while the page is linked to the dev server's AI routes. */
  connected: boolean;
  setConnected: (v: boolean) => void;
  /**
   * Replace the set list from the server, keeping toggles for ids that still exist.
   * `enabledIds` (the server's record of toggles) restores state after a page reload.
   */
  receive: (sets: OverlaySet[], enabledIds?: string[]) => void;
  toggle: (id: string) => void;
  /** Remove one set locally and on the server. */
  remove: (id: string) => void;
  /** Remove every set locally and on the server. */
  clearAll: () => void;
}

type ToggleListener = (id: string, enabled: boolean) => void;
let toggleListener: ToggleListener | null = null;
/** The AI link registers here so toggles reach the server. */
export function onOverlayToggle(fn: ToggleListener | null) {
  toggleListener = fn;
}

function deleteOnServer(id?: string) {
  if (typeof fetch !== 'function') return;
  const url = id ? `/api/ai/overlays?id=${encodeURIComponent(id)}` : '/api/ai/overlays';
  fetch(url, { method: 'DELETE' }).catch(() => {});
}

export const useAiOverlayStore = create<AiOverlayStore>((set, get) => ({
  sets: [],
  enabledIds: [],
  connected: false,

  setConnected: (connected) => set({ connected }),

  receive: (sets, enabledIds) => {
    const ids = new Set(sets.map(s => s.id));
    set(s => {
      const kept = s.enabledIds.filter(id => ids.has(id));
      // Only adopt the server's toggles for ids we had no opinion on (fresh page).
      const restored = (enabledIds ?? []).filter(id => ids.has(id) && !s.sets.some(x => x.id === id));
      return { sets, enabledIds: [...new Set([...kept, ...restored])], connected: true };
    });
  },

  toggle: (id) => {
    const { sets, enabledIds } = get();
    if (!sets.some(s => s.id === id)) return;
    const enabled = !enabledIds.includes(id);
    set({ enabledIds: enabled ? [...enabledIds, id] : enabledIds.filter(x => x !== id) });
    toggleListener?.(id, enabled);
  },

  remove: (id) => {
    set(s => ({ sets: s.sets.filter(x => x.id !== id), enabledIds: s.enabledIds.filter(x => x !== id) }));
    deleteOnServer(id);
  },

  clearAll: () => {
    set({ sets: [], enabledIds: [] });
    deleteOnServer();
  },
}));

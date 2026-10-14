import { create } from 'zustand';
import type { TradeProposal, TradeResult } from '../services/ai/trades.ts';

const AUTO_KEY = 'hl-ai-trade-auto';

function loadAuto(): boolean {
  try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
}

interface AiTradeStore {
  /** Proposals known to the dev server, open and recently finished. */
  trades: TradeProposal[];
  /** Run risk-reducing proposals (closes, entry cancels, tighter stops) without a click. */
  autoConfirm: boolean;
  receive: (trades: TradeProposal[]) => void;
  setAutoConfirm: (on: boolean) => void;
  /** Take a pending proposal so this tab is the one that runs it. Throws with the server's reason. */
  claim: (id: string, decidedBy: 'user' | 'auto') => Promise<void>;
  report: (id: string, result: TradeResult) => Promise<void>;
  reject: (id: string, reason?: string) => Promise<void>;
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, body: json as Record<string, unknown> };
}

export const useAiTradeStore = create<AiTradeStore>((set) => ({
  trades: [],
  autoConfirm: loadAuto(),

  receive: (trades) => set({ trades }),

  setAutoConfirm: (on) => {
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch {}
    set({ autoConfirm: on });
  },

  claim: async (id, decidedBy) => {
    const r = await post(`/api/ai/trades/claim?id=${encodeURIComponent(id)}`, { decidedBy });
    if (!r.ok) throw new Error(String(r.body.error ?? 'claim refused'));
  },

  report: async (id, result) => {
    // The trade already happened; retry a few times so Claude hears about it.
    for (let i = 0; i < 3; i++) {
      try {
        const r = await post(`/api/ai/trades/result?id=${encodeURIComponent(id)}`, result);
        if (r.ok || r.body.error) return;
      } catch {}
      await new Promise(res => setTimeout(res, 1000));
    }
  },

  reject: async (id, reason) => {
    set(s => ({ trades: s.trades.map(t => (t.id === id && t.status === 'pending' ? { ...t, status: 'rejected' as const } : t)) }));
    try { await post(`/api/ai/trades/reject?id=${encodeURIComponent(id)}`, { reason }); } catch {}
  },
}));

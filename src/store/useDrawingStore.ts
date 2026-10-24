import { create } from 'zustand';
import { newId } from '../utils/id.ts';

/** A horizontal level the user drew. Shown on every pane charting `asset`. */
export interface HLineDrawing {
  id: string;
  asset: string;
  price: number;
  /** Optional label, drawn next to the price at the line's right end. */
  text?: string;
  createdAt: number;
}

/** A fib retracement the user drew. Times are UTC ms (the chart converts at draw time). */
export interface FibDrawing {
  id: string;
  asset: string;
  p1: number;
  p2: number;
  t1: number;
  t2: number;
  createdAt: number;
}

interface DrawingStore {
  lines: HLineDrawing[];
  fibs: FibDrawing[];
  addLine: (asset: string, price: number, text?: string) => HLineDrawing;
  moveLine: (id: string, price: number) => void;
  setLineText: (id: string, text: string) => void;
  removeLine: (id: string) => void;
  addFib: (asset: string, fib: { p1: number; p2: number; t1: number; t2: number }) => FibDrawing;
  removeFib: (id: string) => void;
  /** Remove every line and fib drawn on `asset`. */
  clearAsset: (asset: string) => void;
}

const KEY = 'hl-drawings';

interface Saved { lines?: HLineDrawing[]; fibs?: FibDrawing[] }

function load(): Required<Saved> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { lines: [], fibs: [] };
    const parsed = JSON.parse(raw) as Saved;
    return {
      lines: Array.isArray(parsed.lines) ? parsed.lines.filter(l => l && typeof l.price === 'number' && typeof l.asset === 'string') : [],
      fibs: Array.isArray(parsed.fibs) ? parsed.fibs.filter(f => f && typeof f.p1 === 'number' && typeof f.asset === 'string') : [],
    };
  } catch {
    return { lines: [], fibs: [] };
  }
}

function save(data: Required<Saved>) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

export const useDrawingStore = create<DrawingStore>((set, get) => {
  const initial = load();
  const commit = (next: Partial<Required<Saved>>) => {
    const merged = { lines: next.lines ?? get().lines, fibs: next.fibs ?? get().fibs };
    set(merged);
    save(merged);
  };

  return {
    lines: initial.lines,
    fibs: initial.fibs,

    addLine: (asset, price, text) => {
      const line: HLineDrawing = { id: newId(), asset, price, createdAt: Date.now(), ...(text ? { text } : {}) };
      commit({ lines: [...get().lines, line] });
      return line;
    },

    moveLine: (id, price) => {
      commit({ lines: get().lines.map(l => (l.id === id ? { ...l, price } : l)) });
    },

    setLineText: (id, text) => {
      const t = text.trim();
      commit({ lines: get().lines.map(l => {
        if (l.id !== id) return l;
        const { text: _old, ...rest } = l;
        return t ? { ...rest, text: t } : rest;
      }) });
    },

    removeLine: (id) => {
      commit({ lines: get().lines.filter(l => l.id !== id) });
    },

    addFib: (asset, fib) => {
      const f: FibDrawing = { id: newId(), asset, ...fib, createdAt: Date.now() };
      commit({ fibs: [...get().fibs, f] });
      return f;
    },

    removeFib: (id) => {
      commit({ fibs: get().fibs.filter(f => f.id !== id) });
    },

    clearAsset: (asset) => {
      commit({
        lines: get().lines.filter(l => l.asset !== asset),
        fibs: get().fibs.filter(f => f.asset !== asset),
      });
    },
  };
});

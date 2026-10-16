import { create } from 'zustand';

// The two trading colours used across the UI. DOM styles read them as the
// CSS variables --up and --down; canvas code (chart series, primitives) reads
// them from this store, since a canvas cannot resolve var().
export const DEFAULT_UP = '#0ecb81';
export const DEFAULT_DOWN = '#f6465d';

const THEME_KEY = 'hl-theme';

interface ThemeValues {
  up: string;
  down: string;
  showGrid: boolean;
}

const DEFAULTS: ThemeValues = { up: DEFAULT_UP, down: DEFAULT_DOWN, showGrid: false };

function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

function loadTheme(): ThemeValues {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw);
    return {
      up: isHex(p.up) ? p.up : DEFAULT_UP,
      down: isHex(p.down) ? p.down : DEFAULT_DOWN,
      showGrid: typeof p.showGrid === 'boolean' ? p.showGrid : false,
    };
  } catch { return DEFAULTS; }
}

function saveTheme(t: ThemeValues) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch {}
}

// Written as a stylesheet rule rather than inline on <html>: extensions that
// rewrite page CSS (Dark Reader) track stylesheets but not inline variables.
function applyCssVars(t: ThemeValues) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('hl-theme-vars');
  if (!el) {
    el = document.createElement('style');
    el.id = 'hl-theme-vars';
    document.head.appendChild(el);
  }
  el.textContent = `:root { --up: ${t.up}; --down: ${t.down}; }`;
}

interface ThemeStore extends ThemeValues {
  setUp: (c: string) => void;
  setDown: (c: string) => void;
  setShowGrid: (v: boolean) => void;
  resetColors: () => void;
}

const initial = loadTheme();
applyCssVars(initial);

export const useThemeStore = create<ThemeStore>((set, get) => {
  const update = (patch: Partial<ThemeValues>) => {
    const { up, down, showGrid } = { ...get(), ...patch };
    const next = { up, down, showGrid };
    saveTheme(next);
    applyCssVars(next);
    set(next);
  };
  return {
    ...initial,
    setUp: (up) => update({ up }),
    setDown: (down) => update({ down }),
    setShowGrid: (showGrid) => update({ showGrid }),
    resetColors: () => update({ up: DEFAULT_UP, down: DEFAULT_DOWN }),
  };
});

/** Current up (green) colour, for canvas code that draws outside React. */
export const upColor = () => useThemeStore.getState().up;
/** Current down (red) colour, for canvas code that draws outside React. */
export const downColor = () => useThemeStore.getState().down;

/** "#rrggbb" at the given alpha, as rgba(). */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Candlestick series options for the given up/down colours. */
export function candleColors(up: string, down: string) {
  return {
    upColor: up, downColor: down,
    borderUpColor: up, borderDownColor: down,
    wickUpColor: up, wickDownColor: down,
  };
}

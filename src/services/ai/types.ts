/**
 * Shared types for the AI chart link: the chart snapshot the page reports and
 * the overlay sets an AI pushes back. Used by the page, the Vite AI plugin and
 * (as JSON) the MCP server in scripts/hl-chart-mcp.mjs.
 */

import type { GexSummary } from '../gex/levels.ts';

export interface SnapshotCandle {
  /** Bar open time, UTC ms. */
  t: number;
  /** Bar open time as "YYYY-MM-DD HH:MM ET". */
  et: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SnapshotPosition {
  side: 'long' | 'short';
  size: number;
  entry: number;
  upnl: number;
  liq: number | null;
}

export interface SnapshotOrder {
  /** Exchange order id (live) or paper order id; use it in propose_cancel / replaceOid. */
  oid: number | string;
  side: string;
  type: string;
  price: number;
  size: number;
  reduceOnly: boolean;
  /** Set on TP/SL triggers. */
  tpsl?: 'tp' | 'sl';
}

export interface SnapshotSetup {
  id: string;
  side: 'long' | 'short';
  asset: string;
  entry: number;
  sl: number;
  tp: number;
  size: number;
  riskUsdc: number;
  rr: number;
}

export interface SnapshotFib {
  id: string;
  p1: number;
  p2: number;
  /** UTC ms */
  t1: number;
  /** UTC ms */
  t2: number;
}

export interface ChartSnapshot {
  takenAt: number;
  mode: 'paper' | 'live';
  replay: boolean;
  pane: 'primary' | 'secondary';
  asset: string;
  interval: string;
  timezone: 'America/New_York';
  /** UTC ms of first/last visible bar; `bars` is the full visible count before the 600 cap. */
  visible: { from: number; to: number; bars: number };
  candles: SnapshotCandle[];
  mid: number | null;
  position: SnapshotPosition | null;
  orders: SnapshotOrder[];
  /** Live trading readiness ('ready' = an approved key is loaded) and the account orders go to. */
  trading: { status: 'none' | 'approving' | 'ready'; account: string | null; network: string };
  setups: SnapshotSetup[];
  pendingSetup: { side: 'long' | 'short'; clicks: number[] } | null;
  fibs: SnapshotFib[];
  overlays: Array<{ id: string; name: string; enabled: boolean }>;
  /** GEXBot levels for the asset's options (xyz:SP500 -> SPX etc.); null when the asset has none or nothing has loaded. */
  gex?: GexSummary | null;
}

/* ------------------------------------------------------------ inputs --- */

/** UTC ms (or seconds if < 1e12), ISO-8601 string, or "YYYY-MM-DD HH:MM ET". */
export type TimeInput = number | string;
/** Same as TimeInput, plus "now" (= last bar, drawn to the right edge). */
export type TimeOrNowInput = TimeInput | 'now';

export type ColorName = 'green' | 'red' | 'blue' | 'yellow' | 'orange' | 'purple' | 'white' | 'gray';

export interface HLineInput { type: 'hline'; price: number; text?: string; color?: string; style?: 'solid' | 'dashed'; from?: TimeInput; to?: TimeOrNowInput }
export interface BoxInput { type: 'box'; t1: TimeInput; t2: TimeOrNowInput; p1: number; p2: number; text?: string; color?: string }
export interface LineInput { type: 'line'; t1: TimeInput; p1: number; t2: TimeOrNowInput; p2: number; text?: string; color?: string; extend?: 'right' }
export interface ArrowInput { type: 'arrow'; time: TimeInput; price: number; dir: 'up' | 'down'; text?: string; color?: string }
export interface LabelInput { type: 'label'; time: TimeInput; price: number; text: string; color?: string }
export interface VLineInput { type: 'vline'; time: TimeInput; text?: string; color?: string }

export type OverlayShapeInput = HLineInput | BoxInput | LineInput | ArrowInput | LabelInput | VLineInput;

export interface OverlaySetInput {
  name: string;
  description?: string;
  asset?: string;
  color?: string;
  shapes: OverlayShapeInput[];
}

/* ----------------------------------------------------------- outputs --- */

/** All times are UTC ms. `*Now` flags mean "extend to the chart's right edge". */
export interface HLineShape {
  type: 'hline'; price: number; text?: string; color: string;
  /** `dotted` is for built-in layers (past GEX levels); AI input takes solid or dashed. */
  style: 'solid' | 'dashed' | 'dotted';
  from?: number; to?: number; toNow?: boolean;
  /** Where the label sits: the line's right end (default) or its left end at `from`. */
  labelAt?: 'start' | 'end';
}
export interface BoxShape { type: 'box'; t1: number; t2: number; t2Now?: boolean; /** top */ p1: number; /** bottom */ p2: number; text?: string; color: string }
export interface LineShape { type: 'line'; t1: number; p1: number; t2: number; p2: number; t2Now?: boolean; text?: string; color: string; extend?: 'right' }
export interface ArrowShape { type: 'arrow'; time: number; price: number; dir: 'up' | 'down'; text?: string; color: string }
export interface LabelShape { type: 'label'; time: number; price: number; text: string; color: string }
export interface VLineShape { type: 'vline'; time: number; text?: string; color: string }

export type OverlayShape = HLineShape | BoxShape | LineShape | ArrowShape | LabelShape | VLineShape;

export interface OverlaySet {
  id: string;
  /** One batch = one push (one AI reply). */
  batch: string;
  name: string;
  description?: string;
  asset: string;
  color: string;
  createdAt: number;
  shapes: OverlayShape[];
}

export const SHAPE_TYPES = ['hline', 'box', 'line', 'arrow', 'label', 'vline'] as const;

export const COLOR_NAMES: Record<ColorName, string> = {
  green: '#0ecb81',
  red: '#f6465d',
  blue: '#3861fb',
  yellow: '#f0b90b',
  orange: '#ff8c1a',
  purple: '#a970ff',
  white: '#e1e4e8',
  gray: '#8a8f98',
};

/** Default set colours, assigned in order when a set has none. */
export const SET_PALETTE = ['#f0b90b', '#3d9bff', '#c77dff', '#ff8c1a', '#2ed3b7', '#ff5fa2'];

export const MAX_SHAPES_PER_SET = 40;
export const MAX_SETS_PER_PUSH = 12;

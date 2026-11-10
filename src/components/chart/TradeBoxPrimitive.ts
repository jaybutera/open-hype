import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem,
  AutoscaleInfo,
  ISeriesApi,
  Time,
  SeriesType,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { MAX_TPS, TP_PCT_STEP, type SetupField, type TradeSetup } from '../../store/useTradeSetupStore.ts';
import { upColor, downColor, chartBgColor, withAlpha } from '../../store/useThemeStore.ts';

type DragField = SetupField;

const LINE_HIT_TOLERANCE = 6;
const ENTRY_LINE = '#3861fb';
const LABEL_COLOR = '#e1e4e8';
const EXEC_W = 64;
const CLOSE_W = 20;
const ADD_TP_W = 34;
const BTN_H = 18;
const BTN_GAP = 4;
const CHIP_H = 18;
/** Monospace 11px glyph width, so layout and hit tests agree without a canvas. */
const CHAR_W = 6.7;
const CHIP_PAD = 6;
/** Box width in bars from its start time. */
const BOX_BARS = 30;
const MIN_BOX_W = 80;

interface Rect { x: number; y: number; w: number; h: number }
const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

const textW = (t: string) => t.length * CHAR_W + CHIP_PAD * 2;

type Chart = SeriesAttachedParameter<Time, SeriesType>['chart'];
type Series = ISeriesApi<SeriesType, Time>;

/** Last bar time, its x, the bar interval (s) and the bar spacing (px); null with fewer than two bars. */
function lastBars(chart: Chart, series: Series) {
  const data = series.data();
  if (data.length < 2) return null;
  const ts = chart.timeScale();
  const lastT = data[data.length - 1].time as number;
  const prevT = data[data.length - 2].time as number;
  const lastX = ts.timeToCoordinate(lastT as Time);
  const prevX = ts.timeToCoordinate(prevT as Time);
  if (lastX === null || prevX === null || lastT <= prevT) return null;
  return { lastT, lastX, interval: lastT - prevT, spacing: lastX - prevX };
}

/** Time under pane x, extrapolated past the last bar on the bar interval. */
export function chartXToTime(chart: Chart, series: Series, x: number): number | null {
  const t = chart.timeScale().coordinateToTime(x);
  if (t !== null) return t as number;
  const b = lastBars(chart, series);
  if (!b || x <= b.lastX) return null;
  return b.lastT + Math.round((x - b.lastX) / b.spacing) * b.interval;
}

function timeToX(chart: Chart, series: Series, t: number): { x: number; spacing: number } | null {
  const b = lastBars(chart, series);
  if (!b) return null;
  const x = chart.timeScale().timeToCoordinate(t as Time);
  if (x !== null) return { x, spacing: b.spacing };
  return { x: b.lastX + ((t - b.lastT) / b.interval) * b.spacing, spacing: b.spacing };
}

export interface TpLayout {
  id: string;
  y: number;
  /** Chip text: P&L alone with one TP; with several, the leg's number, share, R and P&L. */
  text: string;
  chip: Rect;
  /** ✕ beside the chip; null with a single TP. */
  remove: Rect | null;
}

export interface TradeBoxLayout {
  /** Box left and right edges. */
  x1: number;
  x2: number;
  entryY: number;
  slY: number;
  /** TP legs nearest to entry first, with their chips. */
  tps: TpLayout[];
  /** P&L chips sit right of the box, or left of it when the right side has no room. */
  chipsLeft: boolean;
  info: string;
  execute: Rect;
  /** Adds a TP leg on the next chart click; null at MAX_TPS. */
  addTp: Rect | null;
  remove: Rect;
}

function entryInfo(setup: TradeSetup): string {
  const rr = `R:R ${setup.rr.toFixed(1)}${setup.tps.length > 1 ? ' avg' : ''}`;
  return `${setup.side === 'buy' ? 'LONG' : 'SHORT'} ${fmtSize(setup.assetSize)} · ${rr}`;
}

function tpText(setup: TradeSetup, i: number): string {
  const t = setup.tps[i];
  const move = Math.abs(t.price - setup.entryPrice);
  const pnl = setup.assetSize * (t.pct / 100) * move;
  if (setup.tps.length === 1) return `+${fmtUsd(pnl)} USD`;
  const risk = Math.abs(setup.entryPrice - setup.slPrice);
  const r = risk > 0 ? move / risk : 0;
  return `TP${i + 1} · ${t.pct}% · ${r.toFixed(1)}R · +${fmtUsd(pnl)}`;
}

/**
 * Box from the setup's start time for BOX_BARS bars; without a start time or chart it sits at
 * the right of the pane. Chips go just right of the box, or just left of it when they would
 * run past the pane edge.
 */
export function tradeBoxLayout(
  width: number,
  setup: TradeSetup,
  y: { entryY: number; slY: number; tpYs: number[] },
  chart: Chart | null,
  series: Series | null,
): TradeBoxLayout {
  const info = entryInfo(setup);
  const canAdd = setup.tps.length < MAX_TPS;
  const entryChipW = textW(info) + BTN_GAP + EXEC_W + (canAdd ? BTN_GAP + ADD_TP_W : 0) + BTN_GAP + CLOSE_W;
  let x1: number;
  let x2: number;
  const anchor = chart && series && setup.startTime !== undefined ? timeToX(chart, series, setup.startTime) : null;
  if (anchor) {
    x1 = anchor.x;
    x2 = x1 + Math.max(MIN_BOX_W, BOX_BARS * anchor.spacing);
  } else {
    x2 = width - entryChipW - 12;
    x1 = x2 - 160;
  }
  const chipsLeft = x2 + 6 + entryChipW > width - 4 && x1 - 6 - entryChipW >= 4;
  const chipX = chipsLeft ? x1 - 6 - entryChipW : Math.max(4, Math.min(x2 + 6, width - entryChipW - 4));
  const by = y.entryY - BTN_H / 2;
  const execute = { x: chipX + textW(info) + BTN_GAP, y: by, w: EXEC_W, h: BTN_H };
  const addTp = canAdd ? { x: execute.x + EXEC_W + BTN_GAP, y: by, w: ADD_TP_W, h: BTN_H } : null;
  const remove = { x: (addTp ? addTp.x + ADD_TP_W : execute.x + EXEC_W) + BTN_GAP, y: by, w: CLOSE_W, h: BTN_H };
  const multi = setup.tps.length > 1;
  const tps = setup.tps.map((t, i): TpLayout => {
    const text = tpText(setup, i);
    const ty = y.tpYs[i];
    const w = textW(text) + (multi ? BTN_GAP + CLOSE_W : 0);
    const cx = chipsLeft ? x1 - 6 - w : chipX;
    const chip = { x: cx, y: ty - CHIP_H / 2, w: textW(text), h: CHIP_H };
    const remove = multi ? { x: cx + textW(text) + BTN_GAP, y: ty - BTN_H / 2, w: CLOSE_W, h: BTN_H } : null;
    return { id: t.id, y: ty, text, chip, remove };
  });
  return { x1, x2, entryY: y.entryY, slY: y.slY, tps, chipsLeft, info, execute, addTp, remove };
}

export interface TradeBoxActions {
  onExecute: (id: string) => void;
  onRemove: (id: string) => void;
  onDrag: (id: string, field: DragField, price: number) => void;
  onAddTp: (id: string) => void;
  onRemoveTp: (id: string, tpId: string) => void;
  onNudgeTp: (id: string, tpId: string, delta: number) => void;
}

export class TradeBoxPrimitive implements ISeriesPrimitive<Time> {
  private _setup: TradeSetup;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: Chart | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [TradeBoxPaneView, TradeBoxPaneView];
  private _actions: TradeBoxActions;
  private _axisViews: LevelAxisView[] = [];

  // Drag state
  private _dragging: DragField | null = null;
  /** Pane width from the last draw, for button hit tests. */
  _width = 0;

  constructor(setup: TradeSetup, actions: TradeBoxActions) {
    this._setup = setup;
    this._actions = actions;
    this._paneViews = [new TradeBoxPaneView(this, 'bottom'), new TradeBoxPaneView(this, 'top')];
    this._syncAxisViews();
  }

  get setup() { return this._setup; }
  get series() { return this._series; }

  /** One axis label per level; rebuilt when the TP legs change. */
  private _syncAxisViews() {
    const fields: DragField[] = [...this._setup.tps.map(t => `tp:${t.id}` as const), 'entry', 'sl'];
    if (fields.length === this._axisViews.length && fields.every((f, i) => this._axisViews[i].field === f)) return;
    this._axisViews = fields.map(f => new LevelAxisView(this, f));
  }

  updateSetup(setup: TradeSetup) {
    this._setup = setup;
    this._syncAxisViews();
    this._requestUpdate?.();
  }

  updateCallbacks(actions: TradeBoxActions) {
    this._actions = actions;
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this._series = param.series;
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._series = null;
    this._chart = null;
    this._requestUpdate = null;
  }

  paneViews() { return this._paneViews; }

  /** Entry, TP and SL prices on the price scale. */
  priceAxisViews() { return this._axisViews; }

  /** Price of a level on the box. */
  priceOf(field: DragField): number {
    const s = this._setup;
    if (field === 'entry') return s.entryPrice;
    if (field === 'sl') return s.slPrice;
    if (field === 'tp') return s.tpPrice;
    return s.tps.find(t => t.id === field.slice(3))?.price ?? s.tpPrice;
  }

  /** Keep entry, SL and every TP inside the price scale, so a level past the candles still shows. */
  autoscaleInfo(): AutoscaleInfo {
    const { entryPrice, slPrice, tps } = this._setup;
    const all = [entryPrice, slPrice, ...tps.map(t => t.price)];
    return { priceRange: { minValue: Math.min(...all), maxValue: Math.max(...all) } };
  }

  updateAllViews() {
    // Called when viewport changes — pane view will re-render using latest coords
  }

  /** Current layout at the last drawn pane width; null before the first draw. */
  layout(): TradeBoxLayout | null {
    if (!this._series || this._width <= 0) return null;
    const entryY = this._series.priceToCoordinate(this._setup.entryPrice);
    const slY = this._series.priceToCoordinate(this._setup.slPrice);
    const tpYs = this._setup.tps.map(t => this._series!.priceToCoordinate(t.price));
    if (entryY === null || slY === null || tpYs.some(v => v === null)) return null;
    return tradeBoxLayout(this._width, this._setup, { entryY, slY, tpYs: tpYs as number[] }, this._chart, this._series);
  }

  /** Click on the drawn Execute / +TP / ✕ buttons. Returns true when a button took the click. */
  handleButtonClick(x: number, y: number): boolean {
    const b = this.layout();
    if (!b) return false;
    const id = this._setup.id;
    if (inRect(b.execute, x, y)) { this._actions.onExecute(id); return true; }
    if (b.addTp && inRect(b.addTp, x, y)) { this._actions.onAddTp(id); return true; }
    if (inRect(b.remove, x, y)) { this._actions.onRemove(id); return true; }
    for (const t of b.tps) {
      if (t.remove && inRect(t.remove, x, y)) { this._actions.onRemoveTp(id, t.id); return true; }
    }
    return false;
  }

  /** Wheel over a TP chip moves that leg's share by TP_PCT_STEP. Returns true when it took the wheel. */
  handleWheel(x: number, y: number, deltaY: number): boolean {
    if (this._setup.tps.length < 2 || deltaY === 0) return false;
    const b = this.layout();
    const t = b?.tps.find(tp => inRect(tp.chip, x, y));
    if (!t) return false;
    this._actions.onNudgeTp(this._setup.id, t.id, deltaY < 0 ? TP_PCT_STEP : -TP_PCT_STEP);
    return true;
  }

  /** Level line under (x, y): entry first, then SL, then the TPs. */
  private _lineAt(b: TradeBoxLayout, x: number, y: number): DragField | null {
    if (x < b.x1 - LINE_HIT_TOLERANCE) return null;
    if (Math.abs(y - b.entryY) <= LINE_HIT_TOLERANCE) return 'entry';
    if (Math.abs(y - b.slY) <= LINE_HIT_TOLERANCE) return 'sl';
    const tp = b.tps.find(t => Math.abs(y - t.y) <= LINE_HIT_TOLERANCE);
    return tp ? `tp:${tp.id}` : null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const b = this.layout();
    if (!b) return null;
    const id = this._setup.id;
    const pointer = (what: string) => ({ cursorStyle: 'pointer', externalId: `${what}-${id}` }) as PrimitiveHoveredItem;
    if (inRect(b.execute, x, y)) return pointer('execute');
    if (b.addTp && inRect(b.addTp, x, y)) return pointer('add-tp');
    if (inRect(b.remove, x, y)) return pointer('remove');
    for (const t of b.tps) {
      if (t.remove && inRect(t.remove, x, y)) return pointer(`remove-tp-${t.id}`);
      if (b.tps.length > 1 && inRect(t.chip, x, y)) return { cursorStyle: 'ns-resize', externalId: `pct-${t.id}` } as PrimitiveHoveredItem;
    }
    const line = this._lineAt(b, x, y);
    return line ? ({ cursorStyle: 'ns-resize', externalId: `drag-${line}-${id}` } as PrimitiveHoveredItem) : null;
  }

  // Called externally from chart mouse handlers (drag only; buttons go through handleButtonClick)
  handleMouseDown(x: number, y: number): boolean {
    const b = this.layout();
    if (!b) return false;
    this._dragging = this._lineAt(b, x, y);
    return this._dragging !== null;
  }

  handleMouseMove(price: number): boolean {
    if (!this._dragging) return false;
    this._actions.onDrag(this._setup.id, this._dragging, price);
    return true;
  }

  handleMouseUp(): boolean {
    if (!this._dragging) return false;
    this._dragging = null;
    return true;
  }

  get isDragging() { return this._dragging !== null; }
}


/** Zones and lines draw under the candles; chips and buttons draw over them. */
type Layer = 'bottom' | 'top';

class TradeBoxPaneView implements ISeriesPrimitivePaneView {
  private _layer: Layer;
  private _renderer: TradeBoxRenderer;

  constructor(primitive: TradeBoxPrimitive, layer: Layer) {
    this._layer = layer;
    this._renderer = new TradeBoxRenderer(primitive, layer);
  }

  zOrder(): Layer {
    return this._layer;
  }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

class TradeBoxRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: TradeBoxPrimitive;
  private _layer: Layer;

  constructor(primitive: TradeBoxPrimitive, layer: Layer) {
    this._primitive = primitive;
    this._layer = layer;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const w = mediaSize.width;
      this._primitive._width = w;
      const L = this._primitive.layout();
      if (!L) return;
      const { x1, x2, entryY, slY, tps } = L;
      const bw = x2 - x1;

      if (this._layer === 'top') {
        this._drawChips(ctx, L);
        return;
      }

      // Profit zone entry → TP1, lighter on out to the last TP; loss zone entry → SL
      const tp1Y = tps[0].y;
      const lastY = tps[tps.length - 1].y;
      ctx.fillStyle = withAlpha(upColor(), 0.22);
      ctx.fillRect(x1, Math.min(entryY, tp1Y), bw, Math.abs(tp1Y - entryY));
      if (tps.length > 1) {
        ctx.fillStyle = withAlpha(upColor(), 0.11);
        ctx.fillRect(x1, Math.min(tp1Y, lastY), bw, Math.abs(lastY - tp1Y));
      }
      ctx.fillStyle = withAlpha(downColor(), 0.22);
      ctx.fillRect(x1, Math.min(entryY, slY), bw, Math.abs(slY - entryY));

      // Level edges inside the box, dotted on to the price scale
      const levels: Array<readonly [number, string, number]> = [
        ...tps.map(t => [t.y, upColor(), 1] as const),
        [slY, downColor(), 1],
        [entryY, ENTRY_LINE, 1.5],
      ];
      for (const [yy, color, lw] of levels) {
        drawDashedLine(ctx, x1, x2, yy, color, lw, []);
        drawDashedLine(ctx, x2, w, yy, color, 1, [1, 3]);
      }
    });
  }

  private _drawChips(ctx: CanvasRenderingContext2D, L: TradeBoxLayout) {
    const setup = this._primitive.setup;
    const { x1, entryY, slY } = L;
    const isLong = setup.side === 'buy';
    const entryX = L.execute.x - BTN_GAP - textW(L.info);
    for (const t of L.tps) {
      drawChip(ctx, t.chip.x, t.y, t.text, upColor());
      if (t.remove) drawButton(ctx, t.remove, '#2a2f3e', '✕');
    }
    const slText = `−${fmtUsd(setup.potentialLoss)} USD`;
    drawChip(ctx, L.chipsLeft ? x1 - 6 - textW(slText) : entryX, slY, slText, downColor());
    drawChip(ctx, entryX, entryY, L.info, ENTRY_LINE);
    drawButton(ctx, L.execute, isLong ? upColor() : downColor(), 'EXECUTE');
    if (L.addTp) drawButton(ctx, L.addTp, '#2a2f3e', '+TP');
    drawButton(ctx, L.remove, '#2a2f3e', '✕');
  }
}

class LevelAxisView implements ISeriesPrimitiveAxisView {
  private _primitive: TradeBoxPrimitive;
  readonly field: DragField;

  constructor(primitive: TradeBoxPrimitive, field: DragField) {
    this._primitive = primitive;
    this.field = field;
  }

  coordinate(): number {
    return this._primitive.series?.priceToCoordinate(this._primitive.priceOf(this.field)) ?? -1;
  }

  text(): string { return fmtPrice(this._primitive.priceOf(this.field)); }
  textColor(): string { return '#ffffff'; }
  backColor(): string {
    return this.field === 'entry' ? ENTRY_LINE : this.field === 'sl' ? downColor() : upColor();
  }
}

function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number, x2: number, y: number,
  color: string, width: number, dash: number[],
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function drawButton(ctx: CanvasRenderingContext2D, r: Rect, bg: string, text: string) {
  ctx.save();
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.restore();
}

/** One-line chip centred on y with a coloured border, like an order line tag. */
function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  const r = { x, y: y - CHIP_H / 2, w: textW(text), h: CHIP_H };
  ctx.save();
  ctx.fillStyle = withAlpha(chartBgColor(), 0.92);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w, r.h, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color === ENTRY_LINE ? LABEL_COLOR : color;
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, r.x + CHIP_PAD, y + 1);
  ctx.restore();
}

function fmtUsd(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSize(v: number): string {
  return Number(v.toPrecision(4)).toString();
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

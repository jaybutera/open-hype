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
import type { TradeSetup } from '../../store/useTradeSetupStore.ts';
import { upColor, downColor, chartBgColor, withAlpha } from '../../store/useThemeStore.ts';

type DragField = 'entry' | 'sl' | 'tp';

const LINE_HIT_TOLERANCE = 6;
const ENTRY_LINE = '#3861fb';
const LABEL_COLOR = '#e1e4e8';
const EXEC_W = 64;
const CLOSE_W = 20;
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

export interface TradeBoxLayout {
  /** Box left and right edges. */
  x1: number;
  x2: number;
  entryY: number;
  slY: number;
  tpY: number;
  /** P&L chips sit right of the box, or left of it when the right side has no room. */
  chipsLeft: boolean;
  info: string;
  execute: Rect;
  remove: Rect;
}

function entryInfo(setup: TradeSetup): string {
  return `${setup.side === 'buy' ? 'LONG' : 'SHORT'} ${fmtSize(setup.assetSize)} · R:R ${setup.rr.toFixed(1)}`;
}

/**
 * Box from the setup's start time for BOX_BARS bars; without a start time or chart it sits at
 * the right of the pane. Chips go just right of the box, or just left of it when they would
 * run past the pane edge.
 */
export function tradeBoxLayout(
  width: number,
  setup: TradeSetup,
  y: { entryY: number; slY: number; tpY: number },
  chart: Chart | null,
  series: Series | null,
): TradeBoxLayout {
  const info = entryInfo(setup);
  const entryChipW = textW(info) + BTN_GAP + EXEC_W + BTN_GAP + CLOSE_W;
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
  const remove = { x: execute.x + EXEC_W + BTN_GAP, y: by, w: CLOSE_W, h: BTN_H };
  return { x1, x2, ...y, chipsLeft, info, execute, remove };
}

export class TradeBoxPrimitive implements ISeriesPrimitive<Time> {
  private _setup: TradeSetup;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: Chart | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [TradeBoxPaneView, TradeBoxPaneView];
  private _onExecute: (id: string) => void;
  private _onRemove: (id: string) => void;
  private _onDrag: (id: string, field: DragField, price: number) => void;

  // Drag state
  private _dragging: DragField | null = null;
  /** Pane width from the last draw, for button hit tests. */
  _width = 0;

  constructor(
    setup: TradeSetup,
    onExecute: (id: string) => void,
    onRemove: (id: string) => void,
    onDrag: (id: string, field: DragField, price: number) => void,
  ) {
    this._setup = setup;
    this._onExecute = onExecute;
    this._onRemove = onRemove;
    this._onDrag = onDrag;
    this._paneViews = [new TradeBoxPaneView(this, 'bottom'), new TradeBoxPaneView(this, 'top')];
    this._axisViews = [
      new LevelAxisView(this, 'tp'),
      new LevelAxisView(this, 'entry'),
      new LevelAxisView(this, 'sl'),
    ];
  }

  private _axisViews: LevelAxisView[];

  get setup() { return this._setup; }
  get series() { return this._series; }

  updateSetup(setup: TradeSetup) {
    this._setup = setup;
    this._requestUpdate?.();
  }

  updateCallbacks(
    onExecute: (id: string) => void,
    onRemove: (id: string) => void,
    onDrag: (id: string, field: DragField, price: number) => void,
  ) {
    this._onExecute = onExecute;
    this._onRemove = onRemove;
    this._onDrag = onDrag;
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

  /** Keep entry, SL and TP inside the price scale, so a level past the candles still shows. */
  autoscaleInfo(): AutoscaleInfo {
    const { entryPrice, slPrice, tpPrice } = this._setup;
    return {
      priceRange: {
        minValue: Math.min(entryPrice, slPrice, tpPrice),
        maxValue: Math.max(entryPrice, slPrice, tpPrice),
      },
    };
  }

  updateAllViews() {
    // Called when viewport changes — pane view will re-render using latest coords
  }

  /** Current layout at the last drawn pane width; null before the first draw. */
  layout(): TradeBoxLayout | null {
    if (!this._series || this._width <= 0) return null;
    const entryY = this._series.priceToCoordinate(this._setup.entryPrice);
    const slY = this._series.priceToCoordinate(this._setup.slPrice);
    const tpY = this._series.priceToCoordinate(this._setup.tpPrice);
    if (entryY === null || slY === null || tpY === null) return null;
    return tradeBoxLayout(this._width, this._setup, { entryY, slY, tpY }, this._chart, this._series);
  }

  /** Click on the drawn Execute / ✕ buttons. Returns true when a button took the click. */
  handleButtonClick(x: number, y: number): boolean {
    const b = this.layout();
    if (!b) return false;
    if (inRect(b.execute, x, y)) { this._onExecute(this._setup.id); return true; }
    if (inRect(b.remove, x, y)) { this._onRemove(this._setup.id); return true; }
    return false;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const b = this.layout();
    if (!b) return null;
    if (b && inRect(b.execute, x, y)) {
      return { cursorStyle: 'pointer', externalId: `execute-${this._setup.id}` } as PrimitiveHoveredItem;
    }
    if (b && inRect(b.remove, x, y)) {
      return { cursorStyle: 'pointer', externalId: `remove-${this._setup.id}` } as PrimitiveHoveredItem;
    }
    if (x < b.x1 - LINE_HIT_TOLERANCE) return null;
    const { entryY, slY, tpY } = b;

    if (entryY !== null && Math.abs(y - entryY) <= LINE_HIT_TOLERANCE) {
      return { cursorStyle: 'ns-resize', externalId: `drag-entry-${this._setup.id}` } as PrimitiveHoveredItem;
    }
    if (slY !== null && Math.abs(y - slY) <= LINE_HIT_TOLERANCE) {
      return { cursorStyle: 'ns-resize', externalId: `drag-sl-${this._setup.id}` } as PrimitiveHoveredItem;
    }
    if (tpY !== null && Math.abs(y - tpY) <= LINE_HIT_TOLERANCE) {
      return { cursorStyle: 'ns-resize', externalId: `drag-tp-${this._setup.id}` } as PrimitiveHoveredItem;
    }

    return null;
  }

  // Called externally from chart mouse handlers (drag only; buttons go through handleButtonClick)
  handleMouseDown(x: number, y: number): boolean {
    const b = this.layout();
    if (!b || x < b.x1 - LINE_HIT_TOLERANCE) return false;
    const { entryY, slY, tpY } = b;

    if (entryY !== null && Math.abs(y - entryY) <= LINE_HIT_TOLERANCE) {
      this._dragging = 'entry';
      return true;
    }
    if (slY !== null && Math.abs(y - slY) <= LINE_HIT_TOLERANCE) {
      this._dragging = 'sl';
      return true;
    }
    if (tpY !== null && Math.abs(y - tpY) <= LINE_HIT_TOLERANCE) {
      this._dragging = 'tp';
      return true;
    }
    return false;
  }

  handleMouseMove(price: number): boolean {
    if (!this._dragging) return false;
    this._onDrag(this._setup.id, this._dragging, price);
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
      const { x1, x2, entryY, slY, tpY } = L;
      const bw = x2 - x1;

      if (this._layer === 'top') {
        this._drawChips(ctx, L);
        return;
      }

      // Profit zone (entry → TP) and loss zone (entry → SL)
      ctx.fillStyle = withAlpha(upColor(), 0.22);
      ctx.fillRect(x1, Math.min(entryY, tpY), bw, Math.abs(tpY - entryY));
      ctx.fillStyle = withAlpha(downColor(), 0.22);
      ctx.fillRect(x1, Math.min(entryY, slY), bw, Math.abs(slY - entryY));

      // Level edges inside the box, dotted on to the price scale
      for (const [yy, color, lw] of [[tpY, upColor(), 1], [slY, downColor(), 1], [entryY, ENTRY_LINE, 1.5]] as const) {
        drawDashedLine(ctx, x1, x2, yy, color, lw, []);
        drawDashedLine(ctx, x2, w, yy, color, 1, [1, 3]);
      }
    });
  }

  private _drawChips(ctx: CanvasRenderingContext2D, L: TradeBoxLayout) {
    const setup = this._primitive.setup;
    const { x1, entryY, slY, tpY } = L;
    const isLong = setup.side === 'buy';
    // Chips hug the box edge on whichever side they sit
    const chipAt = (text: string) => (L.chipsLeft ? x1 - 6 - textW(text) : L.execute.x - BTN_GAP - textW(L.info));
    const tpText = `+${fmtUsd(setup.potentialPnl)} USD`;
    const slText = `−${fmtUsd(setup.potentialLoss)} USD`;
    drawChip(ctx, chipAt(tpText), tpY, tpText, upColor());
    drawChip(ctx, chipAt(slText), slY, slText, downColor());
    drawChip(ctx, L.execute.x - BTN_GAP - textW(L.info), entryY, L.info, ENTRY_LINE);
    drawButton(ctx, L.execute, isLong ? upColor() : downColor(), 'EXECUTE');
    drawButton(ctx, L.remove, '#2a2f3e', '✕');
  }
}

class LevelAxisView implements ISeriesPrimitiveAxisView {
  private _primitive: TradeBoxPrimitive;
  private _field: DragField;

  constructor(primitive: TradeBoxPrimitive, field: DragField) {
    this._primitive = primitive;
    this._field = field;
  }

  private _price(): number {
    const s = this._primitive.setup;
    return this._field === 'entry' ? s.entryPrice : this._field === 'tp' ? s.tpPrice : s.slPrice;
  }

  coordinate(): number {
    return this._primitive.series?.priceToCoordinate(this._price()) ?? -1;
  }

  text(): string { return fmtPrice(this._price()); }
  textColor(): string { return '#ffffff'; }
  backColor(): string {
    return this._field === 'entry' ? ENTRY_LINE : this._field === 'tp' ? upColor() : downColor();
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

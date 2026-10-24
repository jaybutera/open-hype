import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem,
  ISeriesApi,
  Time,
  SeriesType,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { HLineDrawing } from '../../store/useDrawingStore.ts';
import { chartBgColor, withAlpha } from '../../store/useThemeStore.ts';

const LINE_HIT_TOLERANCE = 6;
export const HLINE_COLOR = '#a78bfa';
const LABEL_COLOR = '#e1e4e8';
const CLOSE_W = 16;
/** Gap between the label pill and the price axis. */
const RIGHT_GAP = 10;

/** Hyperliquid prices carry at most 5 significant figures; lines snap to that. */
export function snapPrice(p: number): number {
  return Number(p.toPrecision(5));
}

export function fmtLinePrice(p: number): string {
  return snapPrice(p).toString();
}

interface Callbacks {
  onMove: (id: string, price: number) => void;
  onRemove: (id: string) => void;
}

/**
 * One user-drawn horizontal level: a solid line across the pane with a label
 * pill at the right end (`text · price` or just the price) and a × to delete.
 * Drag the line to move it; the chart component routes mouse events here the
 * same way it does for order lines.
 */
export class HLinePrimitive implements ISeriesPrimitive<Time> {
  private _line: HLineDrawing;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [HLinePaneView];
  private _axisViews: [HLineAxisView];
  private _cb: Callbacks;

  private _dragging = false;
  private _dragPrice: number | null = null;
  /** Where the last draw put the label pill and the ×, in media px. */
  _label: { x: number; y: number; w: number; h: number } | null = null;
  _close: { x: number; y: number; w: number; h: number } | null = null;

  constructor(line: HLineDrawing, cb: Callbacks) {
    this._line = line;
    this._cb = cb;
    this._paneViews = [new HLinePaneView(this)];
    this._axisViews = [new HLineAxisView(this)];
  }

  get line() { return this._line; }
  get series() { return this._series; }
  get isDragging() { return this._dragging; }
  /** The price to render at: drag preview or the stored price. */
  get displayPrice(): number {
    return this._dragPrice ?? this._line.price;
  }

  update(line: HLineDrawing) {
    this._line = line;
    this._requestUpdate?.();
  }

  updateCallbacks(cb: Callbacks) {
    this._cb = cb;
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews() { return this._paneViews; }
  priceAxisViews() { return this._axisViews; }
  updateAllViews() {}

  private _inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number } | null): boolean {
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** True when (x, y) is on the line or its label. */
  hitLine(x: number, y: number): boolean {
    if (!this._series) return false;
    if (this._inRect(x, y, this._label)) return true;
    const lineY = this._series.priceToCoordinate(this.displayPrice);
    return lineY !== null && Math.abs(y - lineY) <= LINE_HIT_TOLERANCE;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (this._inRect(x, y, this._close)) {
      return { cursorStyle: 'pointer', externalId: `hline-close-${this._line.id}` } as PrimitiveHoveredItem;
    }
    if (this.hitLine(x, y)) {
      return { cursorStyle: 'ns-resize', externalId: `hline-${this._line.id}` } as PrimitiveHoveredItem;
    }
    return null;
  }

  /** Consumes the press when it lands on the × (removes the line) or on the line (starts a drag). */
  handleMouseDown(x: number, y: number): boolean {
    if (this._inRect(x, y, this._close)) {
      this._cb.onRemove(this._line.id);
      return true;
    }
    if (this.hitLine(x, y)) {
      this._dragging = true;
      this._dragPrice = this._line.price;
      return true;
    }
    return false;
  }

  handleMouseMove(price: number): boolean {
    if (!this._dragging) return false;
    this._dragPrice = snapPrice(price);
    this._requestUpdate?.();
    return true;
  }

  handleMouseUp(): boolean {
    if (!this._dragging) return false;
    this._dragging = false;
    const p = this._dragPrice;
    this._dragPrice = null;
    if (p !== null && p !== this._line.price) this._cb.onMove(this._line.id, p);
    else this._requestUpdate?.();
    return true;
  }
}

class HLinePaneView implements ISeriesPrimitivePaneView {
  private _renderer: HLineRenderer;

  constructor(primitive: HLinePrimitive) {
    this._renderer = new HLineRenderer(primitive);
  }

  zOrder(): 'top' { return 'top'; }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

class HLineAxisView implements ISeriesPrimitiveAxisView {
  private _primitive: HLinePrimitive;

  constructor(primitive: HLinePrimitive) {
    this._primitive = primitive;
  }

  coordinate(): number {
    const s = this._primitive.series;
    return s ? (s.priceToCoordinate(this._primitive.displayPrice) ?? -100) : -100;
  }

  text(): string { return fmtLinePrice(this._primitive.displayPrice); }
  textColor(): string { return '#0d1117'; }
  backColor(): string { return HLINE_COLOR; }
  visible(): boolean { return this.coordinate() >= 0; }
  tickVisible(): boolean { return true; }
}

class HLineRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: HLinePrimitive;

  constructor(primitive: HLinePrimitive) {
    this._primitive = primitive;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const series = this._primitive.series;
    if (!series) return;

    const line = this._primitive.line;
    const price = this._primitive.displayPrice;
    const y = series.priceToCoordinate(price);
    if (y === null) {
      this._primitive._label = null;
      this._primitive._close = null;
      return;
    }

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const w = mediaSize.width;

      ctx.save();
      ctx.strokeStyle = HLINE_COLOR;
      ctx.lineWidth = this._primitive.isDragging ? 2 : 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.restore();

      const text = line.text ? `${line.text} · ${fmtLinePrice(price)}` : fmtLinePrice(price);
      ctx.save();
      ctx.font = '11px monospace';
      const textW = ctx.measureText(text).width;
      const padX = 6;
      const padY = 3;
      const labelH = 14 + padY * 2;
      const pillW = textW + padX * 2 + CLOSE_W;
      const labelX = w - pillW - RIGHT_GAP;
      const top = y - labelH / 2;

      ctx.fillStyle = withAlpha(chartBgColor(), 0.88);
      ctx.beginPath();
      ctx.roundRect(labelX, top, pillW, labelH, 3);
      ctx.fill();

      ctx.fillStyle = HLINE_COLOR;
      ctx.fillRect(labelX, top, 2, labelH);

      ctx.fillStyle = LABEL_COLOR;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, labelX + padX, y);

      // × at the pill's right end
      const closeX = labelX + padX + textW + 2;
      ctx.fillStyle = '#8a8f98';
      ctx.textAlign = 'center';
      ctx.fillText('×', closeX + CLOSE_W / 2 - 1, y);
      ctx.restore();

      this._primitive._label = { x: labelX, y: top, w: pillW - CLOSE_W, h: labelH };
      this._primitive._close = { x: closeX, y: top, w: CLOSE_W, h: labelH };
    });
  }
}

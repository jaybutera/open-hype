import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  ISeriesApi,
  Time,
  SeriesType,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { TradeSetup } from '../../store/useTradeSetupStore.ts';

type DragField = 'entry' | 'sl' | 'tp';

const LINE_HIT_TOLERANCE = 6;
const TP_COLOR = 'rgba(14, 203, 129, 0.15)';
const SL_COLOR = 'rgba(246, 70, 93, 0.15)';
const TP_LINE = '#0ecb81';
const SL_LINE = '#f6465d';
const ENTRY_LINE = '#3861fb';
const LABEL_BG = 'rgba(10, 14, 23, 0.85)';
const LABEL_COLOR = '#e1e4e8';

export class TradeBoxPrimitive implements ISeriesPrimitive<Time> {
  private _setup: TradeSetup;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [TradeBoxPaneView];
  private _onExecute: (id: string) => void;
  private _onRemove: (id: string) => void;
  private _onDrag: (id: string, field: DragField, price: number) => void;

  // Drag state
  private _dragging: DragField | null = null;

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
    this._paneViews = [new TradeBoxPaneView(this)];
  }

  get setup() { return this._setup; }
  get series() { return this._series; }

  updateSetup(setup: TradeSetup) {
    this._setup = setup;
    this._requestUpdate?.();
  }

  updateCallbacks(
    onRemove: (id: string) => void,
    onDrag: (id: string, field: DragField, price: number) => void,
  ) {
    this._onRemove = onRemove;
    this._onDrag = onDrag;
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

  updateAllViews() {
    // Called when viewport changes — pane view will re-render using latest coords
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._series) return null;
    const entryY = this._series.priceToCoordinate(this._setup.entryPrice);
    const slY = this._series.priceToCoordinate(this._setup.slPrice);
    const tpY = this._series.priceToCoordinate(this._setup.tpPrice);

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

  // Called externally from chart mouse handlers (drag only — buttons are HTML overlays)
  handleMouseDown(_x: number, y: number): boolean {
    if (!this._series) return false;
    const entryY = this._series.priceToCoordinate(this._setup.entryPrice);
    const slY = this._series.priceToCoordinate(this._setup.slPrice);
    const tpY = this._series.priceToCoordinate(this._setup.tpPrice);

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


class TradeBoxPaneView implements ISeriesPrimitivePaneView {
  private _primitive: TradeBoxPrimitive;
  private _renderer: TradeBoxRenderer;

  constructor(primitive: TradeBoxPrimitive) {
    this._primitive = primitive;
    this._renderer = new TradeBoxRenderer(primitive);
  }

  zOrder(): 'bottom' {
    return 'bottom';
  }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

class TradeBoxRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: TradeBoxPrimitive;

  constructor(primitive: TradeBoxPrimitive) {
    this._primitive = primitive;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const series = this._primitive.series;
    if (!series) return;

    const setup = this._primitive.setup;
    const entryY = series.priceToCoordinate(setup.entryPrice);
    const slY = series.priceToCoordinate(setup.slPrice);
    const tpY = series.priceToCoordinate(setup.tpPrice);

    if (entryY === null || slY === null || tpY === null) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const w = mediaSize.width;
      const h = mediaSize.height;

      // Draw TP zone (entry → TP)
      const tpTop = Math.min(entryY, tpY);
      const tpBot = Math.max(entryY, tpY);
      ctx.fillStyle = TP_COLOR;
      ctx.fillRect(0, tpTop, w, tpBot - tpTop);

      // Draw SL zone (entry → SL)
      const slTop = Math.min(entryY, slY);
      const slBot = Math.max(entryY, slY);
      ctx.fillStyle = SL_COLOR;
      ctx.fillRect(0, slTop, w, slBot - slTop);

      // Draw lines
      drawDashedLine(ctx, 0, w, entryY, ENTRY_LINE, 2, []);        // solid entry
      drawDashedLine(ctx, 0, w, tpY, TP_LINE, 1.5, [6, 4]);        // dashed TP
      drawDashedLine(ctx, 0, w, slY, SL_LINE, 1.5, [6, 4]);        // dashed SL

      // Labels on the right
      const labelX = w - 200;
      const isLong = setup.side === 'buy';

      // Entry label
      drawLabel(ctx, labelX, entryY - 4, [
        `${isLong ? 'LONG' : 'SHORT'} Entry: ${fmtPrice(setup.entryPrice)}`,
        `Size: ${setup.assetSize.toPrecision(6)}  ($${(setup.assetSize * setup.entryPrice).toFixed(0)})`,
      ], ENTRY_LINE);

      // TP label
      drawLabel(ctx, labelX, tpY + (tpY < entryY ? -4 : 16), [
        `TP: ${fmtPrice(setup.tpPrice)}  +$${setup.potentialPnl.toFixed(2)}`,
      ], TP_LINE);

      // SL label
      drawLabel(ctx, labelX, slY + (slY > entryY ? 4 : -20), [
        `SL: ${fmtPrice(setup.slPrice)}  -$${setup.potentialLoss.toFixed(2)}`,
      ], SL_LINE);

      // R:R label near entry
      drawLabel(ctx, labelX + 140, entryY - 4, [
        `R:R ${setup.rr.toFixed(1)}`,
      ], '#8a8f98');

      // Buttons are rendered as HTML overlays in TradingChart.tsx
    });
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

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  lines: string[],
  accentColor: string,
) {
  ctx.save();
  ctx.font = '11px monospace';
  const lineH = 14;
  const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const padX = 6;
  const padY = 3;
  const totalH = lines.length * lineH + padY * 2;

  ctx.fillStyle = LABEL_BG;
  ctx.beginPath();
  ctx.roundRect(x - padX, y - padY, maxW + padX * 2, totalH, 3);
  ctx.fill();

  // Accent left border
  ctx.fillStyle = accentColor;
  ctx.fillRect(x - padX, y - padY, 2, totalH);

  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + padY + i * lineH);
  }
  ctx.restore();
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

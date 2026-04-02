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
import type { PaperOrder } from '../../engine/paper/matching.ts';

const LINE_HIT_TOLERANCE = 6;
const TP_LINE = '#0ecb81';
const SL_LINE = '#f6465d';
const BUY_LINE = '#3861fb';
const SELL_LINE = '#e67e22';
const LABEL_BG = 'rgba(10, 14, 23, 0.85)';
const LABEL_COLOR = '#e1e4e8';

function orderColor(ord: PaperOrder): string {
  if (ord.tpsl === 'tp') return TP_LINE;
  if (ord.tpsl === 'sl') return SL_LINE;
  return ord.side === 'buy' ? BUY_LINE : SELL_LINE;
}

function orderLabel(ord: PaperOrder): string {
  if (ord.tpsl === 'tp') return 'TP';
  if (ord.tpsl === 'sl') return 'SL';
  return `LIMIT ${ord.side.toUpperCase()}`;
}

function orderPrice(ord: PaperOrder): number {
  return (ord.triggerPx ?? ord.price).toNumber();
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

export class OrderLinePrimitive implements ISeriesPrimitive<Time> {
  private _order: PaperOrder;
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [OrderLinePaneView];
  private _onDragDone: (orderId: string, newPrice: number) => void;

  private _dragging = false;
  private _dragPrice: number | null = null;

  constructor(
    order: PaperOrder,
    onDragDone: (orderId: string, newPrice: number) => void,
  ) {
    this._order = order;
    this._onDragDone = onDragDone;
    this._paneViews = [new OrderLinePaneView(this)];
  }

  get order() { return this._order; }
  get series() { return this._series; }
  /** The price to render at — drag preview or actual order price */
  get displayPrice(): number {
    return this._dragPrice ?? orderPrice(this._order);
  }

  updateOrder(order: PaperOrder) {
    this._order = order;
    this._requestUpdate?.();
  }

  updateCallback(onDragDone: (orderId: string, newPrice: number) => void) {
    this._onDragDone = onDragDone;
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
  updateAllViews() {}

  hitTest(_x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._series) return null;
    const lineY = this._series.priceToCoordinate(this.displayPrice);
    if (lineY !== null && Math.abs(y - lineY) <= LINE_HIT_TOLERANCE) {
      return { cursorStyle: 'ns-resize', externalId: `drag-order-${this._order.id}` } as PrimitiveHoveredItem;
    }
    return null;
  }

  handleMouseDown(_x: number, y: number): boolean {
    if (!this._series) return false;
    const lineY = this._series.priceToCoordinate(orderPrice(this._order));
    if (lineY !== null && Math.abs(y - lineY) <= LINE_HIT_TOLERANCE) {
      this._dragging = true;
      this._dragPrice = orderPrice(this._order);
      return true;
    }
    return false;
  }

  handleMouseMove(price: number): boolean {
    if (!this._dragging) return false;
    this._dragPrice = price;
    this._requestUpdate?.();
    return true;
  }

  handleMouseUp(): boolean {
    if (!this._dragging) return false;
    this._dragging = false;
    if (this._dragPrice !== null) {
      this._onDragDone(this._order.id, this._dragPrice);
      this._dragPrice = null;
    }
    return true;
  }

  get isDragging() { return this._dragging; }
}


class OrderLinePaneView implements ISeriesPrimitivePaneView {
  private _primitive: OrderLinePrimitive;
  private _renderer: OrderLineRenderer;

  constructor(primitive: OrderLinePrimitive) {
    this._primitive = primitive;
    this._renderer = new OrderLineRenderer(primitive);
  }

  zOrder(): 'bottom' { return 'bottom'; }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

class OrderLineRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: OrderLinePrimitive;

  constructor(primitive: OrderLinePrimitive) {
    this._primitive = primitive;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const series = this._primitive.series;
    if (!series) return;

    const ord = this._primitive.order;
    const price = this._primitive.displayPrice;
    const y = series.priceToCoordinate(price);
    if (y === null) return;

    const color = orderColor(ord);
    const label = orderLabel(ord);

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const w = mediaSize.width;

      // Dashed line
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = ord.tpsl ? 2 : 1;
      ctx.setLineDash(ord.tpsl ? [6, 4] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.restore();

      // Label
      const text = `${label} ${ord.size.toString()} @ ${fmtPrice(price)}`;
      ctx.save();
      ctx.font = '11px monospace';
      const textW = ctx.measureText(text).width;
      const padX = 6;
      const padY = 3;
      const labelH = 14 + padY * 2;
      const labelX = w - textW - padX * 2 - 10;

      ctx.fillStyle = LABEL_BG;
      ctx.beginPath();
      ctx.roundRect(labelX, y - labelH / 2, textW + padX * 2, labelH, 3);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.fillRect(labelX, y - labelH / 2, 2, labelH);

      ctx.fillStyle = LABEL_COLOR;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, labelX + padX, y);
      ctx.restore();
    });
  }
}

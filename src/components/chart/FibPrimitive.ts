import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  ISeriesApi,
  IChartApi,
  Time,
  SeriesType,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface FibRetracement {
  id: string;
  p1: number; // first click price
  p2: number; // second click price
  t1: number; // first click time (chart-shifted seconds)
  t2: number; // second click time (chart-shifted seconds)
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const LINE_COLOR = 'rgba(255, 255, 255, 0.35)';
const LABEL_COLOR = 'rgba(255, 255, 255, 0.5)';
const LINE_DASH = [4, 4];
const CLOSE_SIZE = 14;

interface Rect { x: number; y: number; w: number; h: number }

export class FibPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [FibPaneView];
  private _fibs: FibRetracement[] = [];
  /** Where the last draw put each fib's × (keyed by fib id), in media px. */
  _closeRects = new Map<string, Rect>();

  constructor() {
    this._paneViews = [new FibPaneView(this)];
  }

  get series() { return this._series; }
  get chart() { return this._chart; }
  get fibs() { return this._fibs; }

  setFibs(fibs: FibRetracement[]) {
    this._fibs = fibs;
    this._requestUpdate?.();
  }

  addFib(fib: FibRetracement) {
    this._fibs.push(fib);
    this._requestUpdate?.();
  }

  removeFib(id: string) {
    this._fibs = this._fibs.filter(f => f.id !== id);
    this._requestUpdate?.();
  }

  clearFibs() {
    this._fibs = [];
    this._requestUpdate?.();
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
  updateAllViews() {}

  private _closeAt(x: number, y: number): string | null {
    for (const [id, r] of this._closeRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return id;
    }
    return null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const id = this._closeAt(x, y);
    return id ? ({ cursorStyle: 'pointer', externalId: `fib-close-${id}` } as PrimitiveHoveredItem) : null;
  }

  /** Returns the id of the fib whose × was pressed, or null when the press was elsewhere. */
  handleMouseDown(x: number, y: number): string | null {
    return this._closeAt(x, y);
  }
}

class FibPaneView implements ISeriesPrimitivePaneView {
  private _primitive: FibPrimitive;
  private _renderer: FibRenderer;

  constructor(primitive: FibPrimitive) {
    this._primitive = primitive;
    this._renderer = new FibRenderer(primitive);
  }

  zOrder(): 'bottom' { return 'bottom'; }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

class FibRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: FibPrimitive;

  constructor(primitive: FibPrimitive) {
    this._primitive = primitive;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const { series, chart, fibs } = this._primitive;
    if (!series || !chart || fibs.length === 0) return;

    const ts = chart.timeScale();
    this._primitive._closeRects.clear();

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.font = '10px monospace';
      ctx.textBaseline = 'middle';

      for (const fib of fibs) {
        const high = Math.max(fib.p1, fib.p2);
        const low = Math.min(fib.p1, fib.p2);
        const range = high - low;
        if (range === 0) continue;

        const x1 = ts.timeToCoordinate(fib.t1 as Time);
        const x2 = ts.timeToCoordinate(fib.t2 as Time);
        if (x1 === null && x2 === null) continue;
        const left = Math.min(x1 ?? x2!, x2 ?? x1!);
        const right = Math.max(x1 ?? x2!, x2 ?? x1!);

        for (const level of FIB_LEVELS) {
          const price = high - level * range;
          const y = series.priceToCoordinate(price);
          if (y === null) continue;

          ctx.strokeStyle = LINE_COLOR;
          ctx.lineWidth = 1;
          ctx.setLineDash(LINE_DASH);
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();

          // Label on right end
          const label = `${level}`;
          ctx.fillStyle = LABEL_COLOR;
          ctx.textAlign = 'left';
          ctx.fillText(label, right + 4, y - 1);

          // × after the top level's label deletes the fib
          if (level === 0) {
            const labelW = ctx.measureText(label).width;
            const r: Rect = { x: right + 4 + labelW + 4, y: y - CLOSE_SIZE / 2, w: CLOSE_SIZE, h: CLOSE_SIZE };
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.textAlign = 'center';
            ctx.fillText('×', r.x + r.w / 2, y);
            ctx.textAlign = 'left';
            this._primitive._closeRects.set(fib.id, r);
          }
        }
      }

      ctx.restore();
    });
  }
}

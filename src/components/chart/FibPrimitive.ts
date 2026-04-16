import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
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

export class FibPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [FibPaneView];
  private _fibs: FibRetracement[] = [];

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
        }
      }

      ctx.restore();
    });
  }
}

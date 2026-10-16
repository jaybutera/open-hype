import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  ISeriesApi,
  IChartApi,
  Time,
  SeriesType,
  Logical,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { OverlaySet, OverlayShape } from '../../services/ai/types.ts';
import { utcToChartTime } from '../../utils/chartTime.ts';

/**
 * Draws one AI overlay set (boxes, lines, arrows, labels) on a series.
 * Shape times are UTC ms; they are converted to the chart's ET-shifted time at
 * draw time and mapped to x through logical bar indexes, so shapes left or
 * right of the loaded data still land in the right place.
 */
export class AiOverlayPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [AiOverlayPaneView];
  private _set: OverlaySet;

  constructor(set: OverlaySet) {
    this._set = set;
    this._paneViews = [new AiOverlayPaneView(this)];
  }

  get series() { return this._series; }
  get chart() { return this._chart; }
  get set() { return this._set; }

  setSet(set: OverlaySet) {
    this._set = set;
    this._requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this._series = param.series;
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
    // attachPrimitive() does not repaint; without this the set only shows on the next mouse move or tick.
    param.requestUpdate();
  }

  /** Schedule a repaint. Call right before detachPrimitive() so the shapes actually disappear. */
  requestRedraw() {
    this._requestUpdate?.();
  }

  detached() {
    this._series = null;
    this._chart = null;
    this._requestUpdate = null;
  }

  paneViews() { return this._paneViews; }
  updateAllViews() {}
}

class AiOverlayPaneView implements ISeriesPrimitivePaneView {
  private _renderer: AiOverlayRenderer;

  constructor(primitive: AiOverlayPrimitive) {
    this._renderer = new AiOverlayRenderer(primitive);
  }

  zOrder(): 'top' { return 'top'; }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

function rgba(hex: string, a: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Maps UTC ms to x using the series' bar times, extrapolating past either end. */
function makeTimeToX(series: ISeriesApi<SeriesType, Time>, chart: IChartApi) {
  const data = series.data();
  const ts = chart.timeScale();
  const n = data.length;
  const times = new Array<number>(n);
  for (let i = 0; i < n; i++) times[i] = data[i].time as number;
  let barSec = 60;
  if (n >= 2) {
    barSec = Infinity;
    for (let i = Math.max(1, n - 5); i < n; i++) barSec = Math.min(barSec, times[i] - times[i - 1]);
    if (!(barSec > 0)) barSec = 60;
  }

  return (utcMs: number): number | null => {
    const ct = utcToChartTime(Math.floor(utcMs / 1000));
    if (n === 0) return ts.timeToCoordinate(ct as Time);
    let logical: number;
    if (ct <= times[0]) logical = (ct - times[0]) / barSec;
    else if (ct >= times[n - 1]) logical = n - 1 + (ct - times[n - 1]) / barSec;
    else {
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= ct) lo = mid; else hi = mid;
      }
      logical = lo + (ct - times[lo]) / (times[hi] - times[lo]);
    }
    return ts.logicalToCoordinate(logical as Logical);
  };
}

const FONT = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

class AiOverlayRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: AiOverlayPrimitive;

  constructor(primitive: AiOverlayPrimitive) {
    this._primitive = primitive;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const { series, chart, set } = this._primitive;
    if (!series || !chart || set.shapes.length === 0) return;
    const xOf = makeTimeToX(series, chart);
    const yOf = (p: number) => series.priceToCoordinate(p);

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width;
      const H = mediaSize.height;
      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';

      const text = (s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', bg = true) => {
        ctx.textAlign = align;
        if (bg) {
          const w = ctx.measureText(s).width;
          const left = align === 'left' ? x - 3 : align === 'right' ? x - w - 3 : x - w / 2 - 3;
          ctx.fillStyle = 'rgba(10, 14, 23, 0.8)';
          ctx.fillRect(left, y - 8, w + 6, 16);
        }
        ctx.fillStyle = color;
        ctx.fillText(s, x, y);
      };

      for (const shape of set.shapes) {
        this._drawShape(ctx, shape, xOf, yOf, W, H, text);
      }
      ctx.restore();
    });
  }

  private _drawShape(
    ctx: CanvasRenderingContext2D,
    shape: OverlayShape,
    xOf: (t: number) => number | null,
    yOf: (p: number) => number | null,
    W: number,
    H: number,
    text: (s: string, x: number, y: number, color: string, align?: CanvasTextAlign, bg?: boolean) => void,
  ) {
    const color = shape.color;
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;

    switch (shape.type) {
      case 'hline': {
        const y = yOf(shape.price);
        if (y === null) return;
        const x1 = shape.from !== undefined ? (xOf(shape.from) ?? 0) : 0;
        const x2 = shape.toNow || shape.to === undefined ? W : (xOf(shape.to) ?? W);
        ctx.setLineDash(shape.style === 'dashed' ? [6, 4] : shape.style === 'dotted' ? [2, 4] : []);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (shape.text) {
          if (shape.labelAt === 'start') text(shape.text, Math.max(x1, 0) + 6, y - 10, color, 'left');
          else text(shape.text, Math.min(x2, W) - 6, y - 10, color, 'right');
        }
        return;
      }
      case 'box': {
        const xa = xOf(shape.t1);
        const xb = shape.t2Now ? W : xOf(shape.t2);
        const ya = yOf(shape.p1);
        const yb = yOf(shape.p2);
        if (xa === null || xb === null || ya === null || yb === null) return;
        const left = Math.min(xa, xb);
        const right = Math.max(xa, xb, left + 3);
        const top = Math.min(ya, yb);
        const h = Math.max(Math.abs(yb - ya), 1);
        ctx.fillStyle = rgba(color, 0.14);
        ctx.fillRect(left, top, right - left, h);
        ctx.strokeStyle = rgba(color, 0.85);
        ctx.lineWidth = 1;
        ctx.strokeRect(left, top, right - left, h);
        if (shape.text) text(shape.text, left + 5, top + 9, color, 'left', false);
        return;
      }
      case 'line': {
        const x1 = xOf(shape.t1);
        const x2 = xOf(shape.t2);
        const y1 = yOf(shape.p1);
        const y2 = yOf(shape.p2);
        if (x1 === null || x2 === null || y1 === null || y2 === null) return;
        let ex = x2;
        let ey = y2;
        if ((shape.extend === 'right' || shape.t2Now) && x2 !== x1) {
          ex = W;
          ey = y1 + (y2 - y1) * ((W - x1) / (x2 - x1));
        }
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        if (shape.text) text(shape.text, (x1 + x2) / 2, (y1 + y2) / 2 - 12, color, 'center');
        return;
      }
      case 'arrow': {
        const x = xOf(shape.time);
        const y = yOf(shape.price);
        if (x === null || y === null) return;
        const up = shape.dir === 'up';
        const sign = up ? 1 : -1; // up: arrow sits below the price
        const tipY = y + sign * 4;
        const tailY = y + sign * 36;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, tailY);
        ctx.lineTo(x, tipY + sign * 6);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, tipY);
        ctx.lineTo(x - 6, tipY + sign * 10);
        ctx.lineTo(x + 6, tipY + sign * 10);
        ctx.closePath();
        ctx.fill();
        if (shape.text) text(shape.text, x, tailY + sign * 10, color, 'center');
        return;
      }
      case 'label': {
        const x = xOf(shape.time);
        const y = yOf(shape.price);
        if (x === null || y === null) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        text(shape.text, x + 8, y, color, 'left');
        return;
      }
      case 'vline': {
        const x = xOf(shape.time);
        if (x === null) return;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        ctx.setLineDash([]);
        if (shape.text) text(shape.text, x + 4, 12, color, 'left');
        return;
      }
    }
  }
}

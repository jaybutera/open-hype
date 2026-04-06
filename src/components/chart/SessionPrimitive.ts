import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  ISeriesApi,
  IChartApi,
  Time,
  SeriesType,
  CandlestickData,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

// ICT Killzone sessions (EST / UTC-5 hours, stored as UTC)
// Asian:   20:00–00:00 EST  =>  01:00–05:00 UTC
// London:  02:00–05:00 EST  =>  07:00–10:00 UTC
// NY AM:   08:30–11:00 EST  =>  13:30–16:00 UTC
// NY PM:   13:30–16:00 EST  =>  18:30–21:00 UTC

interface Session {
  name: string;
  startH: number; startM: number; // UTC
  endH: number;   endM: number;   // UTC
  color: string; // background box color (low alpha)
}

const SESSIONS: Session[] = [
  { name: 'Asia',  startH: 1,  startM: 0,  endH: 5,  endM: 0,  color: 'rgba(255, 200, 50, 0.04)' },
  { name: 'London', startH: 7,  startM: 0,  endH: 10, endM: 0,  color: 'rgba(50, 150, 255, 0.04)' },
  { name: 'NY AM',  startH: 13, startM: 30, endH: 16, endM: 0,  color: 'rgba(100, 220, 100, 0.04)' },
  { name: 'NY PM',  startH: 18, startM: 30, endH: 21, endM: 0,  color: 'rgba(200, 100, 255, 0.04)' },
];

const HIGH_LOW_COLOR = 'rgba(255, 255, 255, 0.45)';
const HIGH_LOW_WIDTH = 1;
const HIGH_LOW_DASH = [4, 4];

interface SessionRange {
  session: Session;
  startTime: number; // unix seconds
  endTime: number;
  high: number;
  low: number;
  candles: number; // how many candles fell in this range
}

export class SessionPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [SessionPaneView];
  private _enabled = true;
  private _candleData: CandlestickData<Time>[] = [];

  constructor() {
    this._paneViews = [new SessionPaneView(this)];
  }

  get series() { return this._series; }
  get chart() { return this._chart; }
  get enabled() { return this._enabled; }

  setEnabled(v: boolean) {
    this._enabled = v;
    this._requestUpdate?.();
  }

  setCandleData(data: CandlestickData<Time>[]) {
    this._candleData = data;
    this._requestUpdate?.();
  }

  get candleData() { return this._candleData; }

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

/** Build session ranges from candle data within a visible time window */
function buildSessionRanges(
  candles: CandlestickData<Time>[],
  visStartSec: number,
  visEndSec: number,
): SessionRange[] {
  const ranges: SessionRange[] = [];

  // Expand window slightly to catch sessions that overlap edges
  const padSec = 24 * 3600;
  const scanStart = visStartSec - padSec;
  const scanEnd = visEndSec + padSec;

  // Collect unique UTC days in the visible window
  const startDay = Math.floor(scanStart / 86400);
  const endDay = Math.floor(scanEnd / 86400);

  for (let day = startDay; day <= endDay; day++) {
    const dayBase = day * 86400; // midnight UTC of this day
    for (const sess of SESSIONS) {
      const sessStart = dayBase + sess.startH * 3600 + sess.startM * 60;
      const sessEnd = dayBase + sess.endH * 3600 + sess.endM * 60;

      // Skip if entirely outside visible range
      if (sessEnd < visStartSec || sessStart > visEndSec) continue;

      let high = -Infinity;
      let low = Infinity;
      let count = 0;
      for (const c of candles) {
        const t = c.time as number;
        if (t >= sessStart && t < sessEnd) {
          high = Math.max(high, c.high);
          low = Math.min(low, c.low);
          count++;
        }
      }

      if (count > 0) {
        ranges.push({ session: sess, startTime: sessStart, endTime: sessEnd, high, low, candles: count });
      }
    }
  }

  return ranges;
}

class SessionPaneView implements ISeriesPrimitivePaneView {
  private _primitive: SessionPrimitive;
  private _renderer: SessionRenderer;

  constructor(primitive: SessionPrimitive) {
    this._primitive = primitive;
    this._renderer = new SessionRenderer(primitive);
  }

  zOrder(): 'bottom' { return 'bottom'; }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

class SessionRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: SessionPrimitive;

  constructor(primitive: SessionPrimitive) {
    this._primitive = primitive;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const { series, chart, enabled, candleData } = this._primitive;
    if (!series || !chart || !enabled || candleData.length === 0) return;

    const visRange = chart.timeScale().getVisibleRange();
    if (!visRange) return;

    const visStart = visRange.from as number;
    const visEnd = visRange.to as number;

    const ranges = buildSessionRanges(candleData, visStart, visEnd);
    if (ranges.length === 0) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const r of ranges) {
        // Convert session time boundaries to x coordinates
        const x1 = chart.timeScale().timeToCoordinate(r.startTime as Time);
        const x2 = chart.timeScale().timeToCoordinate(r.endTime as Time);
        if (x1 === null || x2 === null) continue;

        const left = Math.max(0, Math.min(x1, x2));
        const right = Math.min(mediaSize.width, Math.max(x1, x2));
        if (right - left < 2) continue;

        // Background box
        ctx.fillStyle = r.session.color;
        ctx.fillRect(left, 0, right - left, mediaSize.height);

        // High/low lines (only within the session box)
        const highY = series.priceToCoordinate(r.high);
        const lowY = series.priceToCoordinate(r.low);

        if (highY !== null) {
          drawSessionLine(ctx, left, right, highY);
        }
        if (lowY !== null) {
          drawSessionLine(ctx, left, right, lowY);
        }

        // Session label at top-left of box
        ctx.save();
        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.textBaseline = 'top';
        ctx.fillText(r.session.name, left + 4, 4);
        ctx.restore();
      }
    });
  }
}

function drawSessionLine(
  ctx: CanvasRenderingContext2D,
  x1: number, x2: number, y: number,
) {
  ctx.save();
  ctx.strokeStyle = HIGH_LOW_COLOR;
  ctx.lineWidth = HIGH_LOW_WIDTH;
  ctx.setLineDash(HIGH_LOW_DASH);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

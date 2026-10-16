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
import { GEX_NEG_COLOR, GEX_POS_COLOR, GEX_ZERO_COLOR } from '../../services/gex/levels.ts';
import { indexAtOrBefore, type GexLevelKey, type GexSample } from '../../services/gex/samples.ts';
import { formatLookback, lookbacksFor } from '../../services/gex/lookbacks.ts';
import { makeTimeToX } from './AiOverlayPrimitive.ts';

export interface GexTrail {
  /** The session's 1-minute samples, ascending by t. */
  samples: readonly GexSample[];
  /** Chart interval; picks the two lookbacks marked with dots. */
  interval: string;
  /** Added to each level before mapping to y. */
  offset: number;
}

const LEVELS: Array<{ key: GexLevelKey; label: string; color: string; dashed: boolean }> = [
  { key: 'zeroGamma', label: '0γ', color: GEX_ZERO_COLOR, dashed: false },
  { key: 'majorPosVol', label: '+γ vol', color: GEX_POS_COLOR, dashed: false },
  { key: 'majorNegVol', label: '-γ vol', color: GEX_NEG_COLOR, dashed: false },
  { key: 'majorPosOi', label: '+γ OI', color: GEX_POS_COLOR, dashed: true },
  { key: 'majorNegOi', label: '-γ OI', color: GEX_NEG_COLOR, dashed: true },
];

/**
 * Where the GEX headline levels were through the session: a stepped path per
 * level through the dev server's 1-minute samples, behind the candles, with a
 * dot and label at the two lookbacks for the chart interval (e.g. `0γ -1h`).
 * The lookbacks count back from the latest sample.
 */
export class GexTrailPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [GexTrailPaneView];
  private _trail: GexTrail;

  constructor(trail: GexTrail) {
    this._trail = trail;
    this._paneViews = [new GexTrailPaneView(this)];
  }

  get series() { return this._series; }
  get chart() { return this._chart; }
  get trail() { return this._trail; }

  setTrail(trail: GexTrail) {
    this._trail = trail;
    this._requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this._series = param.series;
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
    param.requestUpdate();
  }

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

class GexTrailPaneView implements ISeriesPrimitivePaneView {
  private _renderer: GexTrailRenderer;
  constructor(primitive: GexTrailPrimitive) { this._renderer = new GexTrailRenderer(primitive); }
  zOrder(): 'bottom' { return 'bottom'; }
  renderer(): ISeriesPrimitivePaneRenderer | null { return this._renderer; }
}

const FONT = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const LINE_ALPHA = 0.35;
const DOT_R = 2.5;

class GexTrailRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(private _primitive: GexTrailPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const { series, chart, trail } = this._primitive;
    const { samples, interval, offset } = trail;
    if (!series || !chart || samples.length === 0) return;
    const xOf = makeTimeToX(series, chart);
    const yOf = (p: number) => series.priceToCoordinate(p + offset);
    const xs = samples.map(s => xOf(s.t));
    const latest = samples[samples.length - 1].t;
    const marks = lookbacksFor(interval)
      .map(m => ({ m, i: indexAtOrBefore(samples, latest - m * 60_000) }))
      .filter(d => d.i >= 0);

    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (const lvl of LEVELS) {
        ctx.strokeStyle = rgba(lvl.color, LINE_ALPHA);
        ctx.setLineDash(lvl.dashed ? [4, 3] : []);
        ctx.beginPath();
        let started = false;
        let prevY: number | null = null;
        for (let i = 0; i < samples.length; i++) {
          const x = xs[i];
          const y = yOf(samples[i][lvl.key]);
          if (x === null || y === null) { started = false; prevY = null; continue; }
          if (!started) { ctx.moveTo(x, y); started = true; }
          else {
            // Step: hold the previous level until this sample, then jump.
            if (prevY !== null) ctx.lineTo(x, prevY);
            ctx.lineTo(x, y);
          }
          prevY = y;
        }
        ctx.stroke();

        ctx.setLineDash([]);
        for (const { m, i } of marks) {
          const x = xs[i];
          const y = yOf(samples[i][lvl.key]);
          if (x === null || y === null) continue;
          ctx.fillStyle = rgba(lvl.color, 0.9);
          ctx.beginPath();
          ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = rgba(lvl.color, 0.8);
          ctx.fillText(`${lvl.label} ${formatLookback(m)}`, x - DOT_R - 3, y);
        }
      }
      ctx.restore();
    });
  }
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

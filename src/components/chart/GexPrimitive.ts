import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  ISeriesApi,
  Time,
  SeriesType,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { formatGex, type GexData } from '../../services/gex/types.ts';
import { GEX_NEG_COLOR, GEX_POS_COLOR } from '../../services/gex/levels.ts';

export interface GexProfile {
  data: GexData;
  /** Which column to draw. */
  mode: 'vol' | 'oi';
  /** Added to each strike before mapping to y. */
  offset: number;
  /**
   * In vol mode, the GexStrike.priors slots to draw as thinner rows under each
   * bar, shorter lookback first (see lookbacksFor); omit for none.
   */
  priorSlots?: readonly number[];
  /** Labels for priorSlots in the pane legend, like "-5m". */
  priorLabels?: readonly string[];
}

/**
 * Per-strike gamma exposure as horizontal bars growing left from the price
 * axis, behind the candles: green for positive, red for negative, widest bar
 * a quarter of the pane. Strikes outside the visible price range are skipped.
 * In vol mode with `priorSlots`, each bar gets thinner, fainter rows under it
 * with its width at each prior reading on the same scale (shorter lookback
 * first), labelled bars add the change since the longer lookback, and a
 * legend at the top right names the row order.
 */
export class GexPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: [GexPaneView];
  private _profile: GexProfile;

  constructor(profile: GexProfile) {
    this._profile = profile;
    this._paneViews = [new GexPaneView(this)];
  }

  get series() { return this._series; }
  get profile() { return this._profile; }

  setProfile(profile: GexProfile) {
    this._profile = profile;
    this._requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    param.requestUpdate();
  }

  requestRedraw() {
    this._requestUpdate?.();
  }

  detached() {
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews() { return this._paneViews; }
  updateAllViews() {}
}

class GexPaneView implements ISeriesPrimitivePaneView {
  private _renderer: GexRenderer;

  constructor(primitive: GexPrimitive) {
    this._renderer = new GexRenderer(primitive);
  }

  zOrder(): 'bottom' { return 'bottom'; }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

const FONT = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MAX_WIDTH_FRAC = 0.25;
/** Bars at or above this share of the biggest one get a value label. */
const LABEL_FRAC = 0.2;
/** Fill alpha of the past rows, shorter lookback first. */
const PAST_ALPHA = [0.18, 0.12];
const MUTED = '#8a8f98';

class GexRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: GexPrimitive;

  constructor(primitive: GexPrimitive) {
    this._primitive = primitive;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const series = this._primitive.series;
    const { data, mode, offset, priorSlots, priorLabels } = this._primitive.profile;
    const slots = mode === 'vol' && priorSlots ? priorSlots : [];
    if (!series || data.strikes.length === 0) return;
    const yOf = (p: number) => series.priceToCoordinate(p + offset);

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width;
      const H = mediaSize.height;
      const maxW = W * MAX_WIDTH_FRAC;

      let maxAbs = 0;
      for (const s of data.strikes) maxAbs = Math.max(maxAbs, Math.abs(s[mode]));
      if (maxAbs === 0) return;

      // Row heights from the strike spacing on screen, with a gap so rows read as separate strikes.
      let step = Infinity;
      for (let i = 1; i < data.strikes.length; i++) {
        step = Math.min(step, data.strikes[i].strike - data.strikes[i - 1].strike);
      }
      const y0 = yOf(data.strikes[0].strike);
      const y1 = yOf(data.strikes[0].strike + (Number.isFinite(step) ? step : 1));
      const rowPx = y0 !== null && y1 !== null ? Math.abs(y0 - y1) : 6;
      const { barH, pastH } = stackLayout(rowPx, slots.length);
      const past = pastH > 0 ? slots : [];
      const widthOf = (v: number) => Math.min(W, Math.max(1, (Math.abs(v) / maxAbs) * maxW));

      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';

      for (const s of data.strikes) {
        const v = s[mode];
        const y = yOf(s.strike);
        const stackH = barH / 2 + past.length * (pastH + 1);
        if (y === null || y < -stackH || y > H + barH) continue;
        let left = W;
        if (v !== 0) {
          const w = widthOf(v);
          const color = v > 0 ? GEX_POS_COLOR : GEX_NEG_COLOR;
          ctx.fillStyle = rgba(color, 0.28);
          ctx.fillRect(W - w, y - barH / 2, w, barH);
          ctx.fillStyle = rgba(color, 0.9);
          ctx.fillRect(W - w, y - barH / 2, 1.5, barH);
          left = W - w;
        }
        // Earlier readings as thinner rows under the current bar, shorter lookback first.
        let top = y + barH / 2 + 1;
        past.forEach((slot, k) => {
          const pv = s.priors[slot];
          if (pv !== undefined && Number.isFinite(pv) && pv !== 0) {
            const w = widthOf(pv);
            ctx.fillStyle = rgba(pv > 0 ? GEX_POS_COLOR : GEX_NEG_COLOR, PAST_ALPHA[k] ?? 0.12);
            ctx.fillRect(W - w, top, w, pastH);
            left = Math.min(left, W - w);
          }
          top += pastH + 1;
        });
        if (v !== 0 && Math.abs(v) >= maxAbs * LABEL_FRAC && barH >= 7) {
          const x = left - 4;
          const longest = slots.length > 0 ? s.priors[slots[slots.length - 1]] : undefined;
          let dx = 0;
          // Changes too small to show at this scale are left off rather than printed as "-0.0".
          const dText = longest !== undefined && Number.isFinite(longest) ? formatGex(v - longest) : '';
          if (dText && !/^-?0(\.0+)?$/.test(dText)) {
            const delta = `  ${v - longest! > 0 ? '+' : ''}${dText}`;
            ctx.fillStyle = MUTED;
            ctx.fillText(delta, x, y);
            dx = ctx.measureText(delta).width;
          }
          ctx.fillStyle = rgba(v > 0 ? GEX_POS_COLOR : GEX_NEG_COLOR, 0.95);
          ctx.fillText(formatGex(v), x - dx, y);
        }
      }
      if (slots.length > 0 && priorLabels && priorLabels.length === slots.length) {
        ctx.textBaseline = 'top';
        ctx.fillStyle = MUTED;
        ctx.fillText(['now', ...priorLabels].join(' / '), W - 4, 4);
      }
      ctx.restore();
    });
  }
}

/**
 * Heights for the current bar and the past rows under it so the stack
 * (bar, then per past row a 1 px gap and the row) fits in rowPx - 1. The
 * current bar shrinks to fit, down to 3 px; past rows are dropped when the
 * strikes sit closer than 9 px or the stack still does not fit.
 */
export function stackLayout(rowPx: number, pastRows: number): { barH: number; pastH: number } {
  const avail = rowPx - 1;
  let barH = Math.max(1, Math.min(avail, 14));
  if (pastRows === 0 || rowPx < 9) return { barH, pastH: 0 };
  const pastOf = (b: number) => Math.max(2, Math.round(b * 0.45));
  const total = (b: number) => b + pastRows * (pastOf(b) + 1);
  while (total(barH) > avail && barH > 3) barH--;
  if (total(barH) > avail) return { barH: Math.max(1, Math.min(avail, 14)), pastH: 0 };
  return { barH, pastH: pastOf(barH) };
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

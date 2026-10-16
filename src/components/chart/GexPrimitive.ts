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
import { upColor, downColor } from '../../store/useThemeStore.ts';

export interface GexProfile {
  data: GexData;
  /** Which column to draw. */
  mode: 'vol' | 'oi';
  /** Added to each strike before mapping to y. */
  offset: number;
  /**
   * In vol mode, the GexStrike.priors slots to mark as white dots on each bar
   * at the width the bar had then, shorter lookback first (see lookbacksFor);
   * omit for none.
   */
  priorSlots?: readonly number[];
  /** Labels for priorSlots in the pane legend, like "-5m". */
  priorLabels?: readonly string[];
}

/**
 * Per-strike gamma exposure as horizontal bars growing left from the price
 * axis, behind the candles: green for positive, red for negative, widest bar
 * a quarter of the pane. Strikes outside the visible price range are skipped.
 * In vol mode with `priorSlots`, each bar carries a white dot where its edge
 * was at each prior reading on the same scale (brighter for the shorter
 * lookback), labelled bars add the change since the longer lookback, and a
 * legend at the top right names the dots.
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
/** Alpha of the white lookback dots, shorter lookback first. */
export const DOT_ALPHA = [0.85, 0.45];
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

      // Bar height from the strike spacing on screen, with a gap so bars read as separate rows.
      let step = Infinity;
      for (let i = 1; i < data.strikes.length; i++) {
        step = Math.min(step, data.strikes[i].strike - data.strikes[i - 1].strike);
      }
      const y0 = yOf(data.strikes[0].strike);
      const y1 = yOf(data.strikes[0].strike + (Number.isFinite(step) ? step : 1));
      const rowPx = y0 !== null && y1 !== null ? Math.abs(y0 - y1) : 6;
      const barH = Math.max(1, Math.min(rowPx - 1, 14));
      const dotR = dotRadius(barH);
      const widthOf = (v: number) => Math.min(W, Math.max(1, (Math.abs(v) / maxAbs) * maxW));

      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';

      for (const s of data.strikes) {
        const v = s[mode];
        const y = yOf(s.strike);
        if (y === null || y < -barH || y > H + barH) continue;
        let left = W;
        if (v !== 0) {
          const w = widthOf(v);
          const color = v > 0 ? upColor() : downColor();
          ctx.fillStyle = rgba(color, 0.28);
          ctx.fillRect(W - w, y - barH / 2, w, barH);
          ctx.fillStyle = rgba(color, 0.9);
          ctx.fillRect(W - w, y - barH / 2, 1.5, barH);
          left = W - w;
        }
        // Earlier readings as white dots on the same row, at the bar's width back then.
        if (dotR > 0) {
          slots.forEach((slot, k) => {
            const pv = s.priors[slot];
            if (pv === undefined || !Number.isFinite(pv) || pv === 0) return;
            const x = W - widthOf(pv);
            ctx.fillStyle = `rgba(255, 255, 255, ${DOT_ALPHA[k] ?? 0.45})`;
            ctx.beginPath();
            ctx.arc(x, y, dotR, 0, Math.PI * 2);
            ctx.fill();
            left = Math.min(left, x - dotR);
          });
        }
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
          ctx.fillStyle = rgba(v > 0 ? upColor() : downColor(), 0.95);
          ctx.fillText(formatGex(v), x - dx, y);
        }
      }
      // Legend: a dot of each alpha with its lookback label, top right under the price axis.
      if (slots.length > 0 && priorLabels && priorLabels.length === slots.length) {
        let x = W - 4;
        ctx.textBaseline = 'middle';
        const ly = 10;
        for (let k = priorLabels.length - 1; k >= 0; k--) {
          ctx.fillStyle = MUTED;
          ctx.fillText(priorLabels[k], x, ly);
          x -= ctx.measureText(priorLabels[k]).width + 7;
          ctx.fillStyle = `rgba(255, 255, 255, ${DOT_ALPHA[k] ?? 0.45})`;
          ctx.beginPath();
          ctx.arc(x, ly, 3, 0, Math.PI * 2);
          ctx.fill();
          x -= 12;
        }
      }
      ctx.restore();
    });
  }
}

/** Dot radius for a bar of height barH: narrower than the bar, none when the bar is too thin to carry one. */
export function dotRadius(barH: number): number {
  if (barH < 5) return 0;
  return Math.min(3.5, Math.floor(barH * 0.3));
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

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
   * In vol mode, the GexStrike.priors slots to outline each bar as it was
   * earlier, shorter lookback first (see lookbacksFor); omit for no outline.
   */
  priorSlots?: readonly number[];
}

/**
 * Per-strike gamma exposure as horizontal bars growing left from the price
 * axis, behind the candles: green for positive, red for negative, widest bar
 * a quarter of the pane. Strikes outside the visible price range are skipped.
 * In vol mode with `priorSlots`, a 1 px outline over each bar shows its width
 * at each prior reading on the same scale (the shorter lookback brighter), so
 * build and bleed read at a glance.
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
/** Outline alpha per prior slot, shorter lookback first. */
const OUTLINE_ALPHA = [0.7, 0.4];

class GexRenderer implements ISeriesPrimitivePaneRenderer {
  private _primitive: GexPrimitive;

  constructor(primitive: GexPrimitive) {
    this._primitive = primitive;
  }

  draw(target: CanvasRenderingTarget2D): void {
    const series = this._primitive.series;
    const { data, mode, offset, priorSlots } = this._primitive.profile;
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

      ctx.save();
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';

      for (const s of data.strikes) {
        const v = s[mode];
        if (v === 0) continue;
        const y = yOf(s.strike);
        if (y === null || y < -barH || y > H + barH) continue;
        const w = Math.max(1, (Math.abs(v) / maxAbs) * maxW);
        const color = v > 0 ? GEX_POS_COLOR : GEX_NEG_COLOR;
        ctx.fillStyle = rgba(color, 0.28);
        ctx.fillRect(W - w, y - barH / 2, w, barH);
        ctx.fillStyle = rgba(color, 0.9);
        ctx.fillRect(W - w, y - barH / 2, 1.5, barH);
        if (Math.abs(v) >= maxAbs * LABEL_FRAC && barH >= 7) {
          ctx.fillStyle = rgba(color, 0.95);
          ctx.fillText(formatGex(v), W - w - 4, y);
        }
      }
      ctx.lineWidth = 1;
      // Longer lookback first so the brighter, shorter one draws on top.
      for (let k = slots.length - 1; k >= 0; k--) {
        const slot = slots[k];
        const alpha = OUTLINE_ALPHA[k] ?? 0.4;
        for (const s of data.strikes) {
          const pv = s.priors[slot];
          if (pv === undefined || !Number.isFinite(pv) || pv === 0) continue;
          const y = yOf(s.strike);
          if (y === null || y < -barH || y > H + barH) continue;
          const w = Math.min(W, Math.max(1, (Math.abs(pv) / maxAbs) * maxW));
          ctx.strokeStyle = rgba(pv > 0 ? GEX_POS_COLOR : GEX_NEG_COLOR, alpha);
          ctx.strokeRect(Math.round(W - w) + 0.5, Math.round(y - barH / 2) + 0.5, Math.round(w) - 1, Math.max(1, Math.round(barH) - 1));
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

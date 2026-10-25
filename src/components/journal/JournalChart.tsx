import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  type LogicalRange,
} from 'lightweight-charts';
import { fetchCandles } from '../../services/api/info.ts';
import { utcToChartTime } from '../chart/TradingChart.tsx';
import { AiOverlayPrimitive } from '../chart/AiOverlayPrimitive.ts';
import { intervalToMs } from '../../services/replay/aggregate.ts';
import type { CandleData, CandleInterval } from '../../types/market.ts';
import type { TradeWindow } from '../../services/journal/tradeWindows.ts';
import type { OverlayShape } from '../../services/ai/types.ts';
import { useThemeStore, upColor, downColor, candleColors } from '../../store/useThemeStore.ts';

interface Props {
  trade: TradeWindow;
}

/** Bars fetched per step when panning past either end of the loaded data. */
const CHUNK_BARS = 500;
/** Start loading when the view is this many bars from an edge. */
const EDGE_BARS = 20;
const NOTE_COLOR = '#f0b90b';
const EXIT_COLOR = '#8a8f98';

const TIERS: { interval: CandleInterval; maxHeldMs: number; padMs: number }[] = [
  { interval: '1m', maxHeldMs: 2 * 3600_000, padMs: 30 * 60_000 },
  { interval: '5m', maxHeldMs: 12 * 3600_000, padMs: 2 * 3600_000 },
  { interval: '15m', maxHeldMs: 3 * 86_400_000, padMs: 6 * 3600_000 },
  { interval: '1h', maxHeldMs: 14 * 86_400_000, padMs: 86_400_000 },
  { interval: '4h', maxHeldMs: Infinity, padMs: 3 * 86_400_000 },
];

/** Hyperliquid serves only the most recent 5000 bars per interval; keep a margin. */
const HISTORY_BARS = 4800;

/**
 * Pick a candle interval and padding based on how long the trade was held, so a
 * scalp shows minute candles and a multi-day swing shows hourly/daily. Steps up
 * to a coarser interval when the trade is older than the finer one's history.
 */
function pickInterval(entryTime: number, durationMs: number): { interval: CandleInterval; padMs: number } {
  let i = TIERS.findIndex(t => durationMs <= t.maxHeldMs);
  while (i < TIERS.length - 1 && Date.now() - (entryTime - TIERS[i].padMs) > HISTORY_BARS * intervalToMs(TIERS[i].interval)) i++;
  return TIERS[i];
}

/** Candles keyed by bar open (UTC ms), so chunks merge without duplicates. */
function mergeCandles(into: Map<number, CandlestickData>, candles: CandleData[]) {
  for (const c of candles) {
    const o = parseFloat(c.o), h = parseFloat(c.h), l = parseFloat(c.l), cl = parseFloat(c.c);
    if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(cl)) continue;
    into.set(c.t, { time: utcToChartTime(Math.floor(c.t / 1000)) as Time, open: o, high: h, low: l, close: cl });
  }
}

function fmt(n: number): string {
  return String(parseFloat(n.toPrecision(8)));
}

/**
 * The trade drawn the way an MCP overlay set is: a box over the held span from
 * entry to exit, entry and exit lines only across that span, and one arrow per
 * fill at its bar and exact price. Fill and note times snap to their bar's open
 * so the marks sit on the candle they happened in.
 */
function tradeShapes(trade: TradeWindow, barMs: number, closeAt: (t: number) => number | null): OverlayShape[] {
  const snap = (t: number) => Math.floor(t / barMs) * barMs;
  const up = upColor();
  const down = downColor();
  const dirColor = trade.direction === 'long' ? up : down;
  const t1 = snap(trade.entryTime);
  const shapes: OverlayShape[] = [];

  if (trade.exitTime !== null && trade.exitPx !== null) {
    const t2 = snap(trade.exitTime);
    shapes.push({
      type: 'box', t1, t2,
      p1: Math.max(trade.entryPx, trade.exitPx), p2: Math.min(trade.entryPx, trade.exitPx),
      color: trade.realizedPnl >= 0 ? up : down,
    });
    shapes.push({
      type: 'hline', price: trade.entryPx, from: t1, to: t2, style: 'solid', color: dirColor,
      text: `${trade.direction === 'long' ? 'Long' : 'Short'} ${fmt(trade.entryPx)}`, labelAt: 'start',
    });
    shapes.push({
      type: 'hline', price: trade.exitPx, from: t1, to: t2, style: 'dashed', color: EXIT_COLOR,
      text: `Exit ${fmt(trade.exitPx)} · ${trade.realizedPnl >= 0 ? '+' : ''}${trade.realizedPnl.toFixed(2)}`,
    });
  } else {
    shapes.push({
      type: 'hline', price: trade.entryPx, from: t1, toNow: true, style: 'solid', color: dirColor,
      text: `${trade.direction === 'long' ? 'Long' : 'Short'} ${fmt(trade.entryPx)} · open`, labelAt: 'start',
    });
  }

  for (const f of trade.fills) {
    const buy = f.side === 'buy';
    const px = parseFloat(f.price);
    if (!Number.isFinite(px)) continue;
    shapes.push({
      type: 'arrow', time: snap(f.timestamp), price: px, dir: buy ? 'up' : 'down',
      color: buy ? up : down,
      text: `${f.dir ?? (buy ? 'Buy' : 'Sell')} ${f.size} @ ${fmt(px)}`,
    });
  }

  for (const note of trade.notes) {
    const t = snap(note.timestamp);
    const px = closeAt(t);
    if (px === null) continue;
    const preview = note.text.length > 40 ? note.text.slice(0, 40) + '…' : note.text;
    shapes.push({ type: 'label', time: t, price: px, text: preview, color: NOTE_COLOR });
  }
  return shapes;
}

export function JournalChart({ trade }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const up = useThemeStore(s => s.up);
  const down = useThemeStore(s => s.down);
  const showGrid = useThemeStore(s => s.showGrid);
  const chartBg = useThemeStore(s => s.chartBg);

  // Create chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { color: useThemeStore.getState().chartBg }, textColor: '#8a8f98' },
      grid: { vertLines: { color: '#1a1f2e', visible: useThemeStore.getState().showGrid }, horzLines: { color: '#1a1f2e', visible: useThemeStore.getState().showGrid } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: '#2a2f3e', timeVisible: true },
      rightPriceScale: { borderColor: '#2a2f3e' },
    });
    const series = chart.addCandlestickSeries(candleColors(upColor(), downColor()));
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    seriesRef.current?.applyOptions(candleColors(up, down));
    chartRef.current?.applyOptions({
      layout: { background: { color: chartBg } },
      grid: { vertLines: { visible: showGrid }, horzLines: { visible: showGrid } },
    });
  }, [up, down, showGrid, chartBg]);

  // Load candles and the trade drawing whenever the selected trade changes;
  // fetch more bars on either side as the view pans toward an edge.
  useEffect(() => {
    let cancelled = false;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    setLoading(true);
    setError(null);
    series.setData([]);

    const end = trade.exitTime ?? Date.now();
    const { interval, padMs } = pickInterval(trade.entryTime, end - trade.entryTime);
    const barMs = intervalToMs(interval);
    const bars = new Map<number, CandlestickData>();
    let first = Math.floor((trade.entryTime - padMs) / barMs) * barMs;
    let last = Math.floor((end + padMs) / barMs) * barMs;
    let olderDone = false;
    let newerDone = false;
    let busy = false;

    const prim = new AiOverlayPrimitive({
      id: 'journal-trade', batch: 'journal', name: 'Trade', asset: trade.coin,
      color: trade.direction === 'long' ? upColor() : downColor(), createdAt: Date.now(), shapes: [],
    });
    series.attachPrimitive(prim);

    const publish = () => {
      const keys = [...bars.keys()].sort((a, b) => a - b);
      series.setData(keys.map(k => bars.get(k)!));
      const closeAt = (t: number) => bars.get(t)?.close ?? null;
      prim.setSet({ ...prim.set, shapes: tradeShapes(trade, barMs, closeAt) });
      return keys.length;
    };

    const loadEdge = async (side: 'older' | 'newer') => {
      if (busy || cancelled) return;
      if (side === 'older' ? olderDone : newerDone) return;
      busy = true;
      try {
        const from = side === 'older' ? first - CHUNK_BARS * barMs : last + barMs;
        const to = side === 'older' ? first - 1 : Math.min(last + CHUNK_BARS * barMs, Date.now());
        if (to <= from) { newerDone = true; return; }
        const candles = await fetchCandles(trade.coin, interval, from, to);
        if (cancelled) return;
        const before = bars.size;
        mergeCandles(bars, candles);
        const added = bars.size - before;
        if (side === 'older') { first = from; if (added === 0) olderDone = true; }
        else { last = to; if (to >= Date.now() - barMs) newerDone = true; }
        if (added === 0) return;
        // Prepending shifts every logical index; keep the view on the same bars.
        const range = chart.timeScale().getVisibleLogicalRange();
        publish();
        if (side === 'older' && range) {
          chart.timeScale().setVisibleLogicalRange({ from: range.from + added, to: range.to + added });
        }
      } catch {
        // Leave the loaded bars as they are; the next pan retries.
      } finally {
        busy = false;
      }
    };

    const onRange = (range: LogicalRange | null) => {
      if (!range || bars.size === 0) return;
      if (range.from < EDGE_BARS) void loadEdge('older');
      else if (range.to > bars.size - 1 - EDGE_BARS) void loadEdge('newer');
    };

    fetchCandles(trade.coin, interval, first, last)
      .then(candles => {
        if (cancelled) return;
        mergeCandles(bars, candles);
        if (bars.size === 0) {
          setError(`Hyperliquid returned no ${interval} candles for ${trade.coin} around this trade`);
          setLoading(false);
          return;
        }
        if (last >= Date.now() - barMs) newerDone = true;
        publish();
        chart.timeScale().fitContent();
        chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load candles');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      prim.requestRedraw();
      series.detachPrimitive(prim);
    };
  }, [trade]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div style={overlayStyle}>Loading {trade.coin} candles…</div>
      )}
      {error && (
        <div style={{ ...overlayStyle, color: 'var(--down)' }}>{error}</div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  color: '#8a8f98', fontSize: 13, pointerEvents: 'none',
};

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  type SeriesMarker,
  LineStyle,
} from 'lightweight-charts';
import { fetchCandles } from '../../services/api/info.ts';
import { utcToChartTime } from '../chart/TradingChart.tsx';
import type { CandleInterval } from '../../types/market.ts';
import type { TradeWindow } from '../../services/journal/tradeWindows.ts';
import { useThemeStore, upColor, downColor, candleColors } from '../../store/useThemeStore.ts';

interface Props {
  trade: TradeWindow;
}

/**
 * Pick a candle interval and padding based on how long the trade was held, so a
 * scalp shows minute candles and a multi-day swing shows hourly/daily.
 */
function pickInterval(durationMs: number): { interval: CandleInterval; padMs: number } {
  const hour = 3600_000;
  if (durationMs <= 2 * hour) return { interval: '1m', padMs: 30 * 60_000 };
  if (durationMs <= 12 * hour) return { interval: '5m', padMs: 2 * hour };
  if (durationMs <= 3 * 24 * hour) return { interval: '15m', padMs: 6 * hour };
  if (durationMs <= 14 * 24 * hour) return { interval: '1h', padMs: 24 * hour };
  return { interval: '4h', padMs: 3 * 24 * hour };
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

  // Load candles + markers whenever the selected trade changes.
  useEffect(() => {
    let cancelled = false;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    setLoading(true);
    setError(null);

    const end = trade.exitTime ?? Date.now();
    const { interval, padMs } = pickInterval(end - trade.entryTime);
    const start = trade.entryTime - padMs;
    const fetchEnd = end + padMs;

    fetchCandles(trade.coin, interval, start, fetchEnd)
      .then(candles => {
        if (cancelled) return;
        const seen = new Set<number>();
        const data: CandlestickData[] = [];
        for (const c of candles) {
          const t = utcToChartTime(Math.floor(c.t / 1000));
          if (seen.has(t)) continue;
          seen.add(t);
          const o = parseFloat(c.o), h = parseFloat(c.h), l = parseFloat(c.l), cl = parseFloat(c.c);
          if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(cl)) continue;
          data.push({ time: t as Time, open: o, high: h, low: l, close: cl });
        }
        data.sort((a, b) => (a.time as number) - (b.time as number));
        series.setData(data);

        // Entry / exit price lines.
        series.createPriceLine({
          price: trade.entryPx,
          color: trade.direction === 'long' ? upColor() : downColor(),
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `Entry ${trade.entryPx}`,
        });
        if (trade.exitPx !== null) {
          series.createPriceLine({
            price: trade.exitPx,
            color: '#8a8f98',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Exit ${trade.exitPx}`,
          });
        }

        // Markers: entry, exit, and each note (yellow pin above the bar).
        const markers: SeriesMarker<Time>[] = [];
        markers.push({
          time: utcToChartTime(Math.floor(trade.entryTime / 1000)) as Time,
          position: 'belowBar',
          color: trade.direction === 'long' ? upColor() : downColor(),
          shape: trade.direction === 'long' ? 'arrowUp' : 'arrowDown',
          text: trade.direction === 'long' ? 'LONG' : 'SHORT',
        });
        if (trade.exitTime !== null) {
          markers.push({
            time: utcToChartTime(Math.floor(trade.exitTime / 1000)) as Time,
            position: 'aboveBar',
            color: '#8a8f98',
            shape: 'square',
            text: 'EXIT',
          });
        }
        for (const note of trade.notes) {
          const preview = note.text.length > 30 ? note.text.slice(0, 30) + '…' : note.text;
          markers.push({
            time: utcToChartTime(Math.floor(note.timestamp / 1000)) as Time,
            position: 'aboveBar',
            color: '#f0b90b',
            shape: 'circle',
            text: `📝 ${preview}`,
          });
        }
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        series.setMarkers(markers);

        chart.timeScale().fitContent();
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load candles');
        setLoading(false);
      });

    return () => { cancelled = true; };
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

import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type HistogramData, type Time, type IPriceLine, LineStyle } from 'lightweight-charts';
import { useMarketStore, type PaneId } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useThemeStore, upColor, downColor, withAlpha, candleColors } from '../../store/useThemeStore.ts';
import { useLiveAccountStore } from '../../store/useLiveAccountStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useTradeSetupStore } from '../../store/useTradeSetupStore.ts';
import { TradeBoxPrimitive, chartXToTime } from './TradeBoxPrimitive.ts';
import { OrderLinePrimitive, isLiveDraggable, isLiveTrigger, liveLinePx, liveLineOrders, type LineOrder } from './OrderLinePrimitive.ts';
import { modifyLiveLimit, modifyLiveTrigger, triggerKind } from '../../services/hl/liveTrader.ts';
import { SessionPrimitive } from './SessionPrimitive.ts';
import { FibPrimitive } from './FibPrimitive.ts';
import { HLinePrimitive, snapPrice } from './HLinePrimitive.ts';
import { DrawToolbox, type DrawTool } from './DrawToolbox.tsx';
import { useDrawingStore } from '../../store/useDrawingStore.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { CandleInterval } from '../../types/market.ts';
import { utcToChartTime, chartTimeToUtc, formatEt } from '../../utils/chartTime.ts';
import { AiOverlayPrimitive } from './AiOverlayPrimitive.ts';
import { useAiOverlayStore } from '../../store/useAiOverlayStore.ts';
import { registerSnapshotProvider } from '../../services/ai/link.ts';
import type { SnapshotCandle, OverlaySet } from '../../services/ai/types.ts';
import { useAlertStore } from '../../store/useAlertStore.ts';
import { alertLine } from '../../services/ai/alerts.ts';
import { GexPrimitive } from './GexPrimitive.ts';
import { GexToolbar, toolbarButtonStyle } from './GexToolbar.tsx';
import { lookbackLabel, lookbacksFor } from '../../services/gex/lookbacks.ts';
import { useGexStore } from '../../store/useGexStore.ts';
import { useGexFeed } from '../../services/gex/useGexFeed.ts';
import { gexLevelSet } from '../../services/gex/levels.ts';

/** Max candles a snapshot carries (the most recent visible ones). */
const SNAPSHOT_MAX_BARS = 600;

// Chart-time helpers live in utils/chartTime.ts; re-exported for existing importers.
export { getNyOffset, utcToChartTime, chartTimeToUtc } from '../../utils/chartTime.ts';

const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface Props {
  engine: PaperEngine;
  paneId?: PaneId;
}

const VOLUME_KEY = 'hl-volume';
const TOOLBOX_KEY = 'hl-draw-toolbox';

export function TradingChart({ engine, paneId = 'primary' }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const tradeBoxPrimitivesRef = useRef<Map<string, TradeBoxPrimitive>>(new Map());
  const orderLinePrimitivesRef = useRef<Map<string, OrderLinePrimitive>>(new Map());
  const sessionPrimitiveRef = useRef<SessionPrimitive | null>(null);
  const fibPrimitiveRef = useRef<FibPrimitive | null>(null);
  const hlinePrimitivesRef = useRef<Map<string, HLinePrimitive>>(new Map());
  const [sessionsOn, setSessionsOn] = useState(true);
  const [alertsOn, setAlertsOn] = useState(true);
  const [volumeOn, setVolumeOn] = useState(() => {
    try { return localStorage.getItem(VOLUME_KEY) === '1'; } catch { return false; }
  });
  const [toolboxOpen, setToolboxOpen] = useState(() => {
    try { return localStorage.getItem(TOOLBOX_KEY) === '1'; } catch { return false; }
  });
  /** Armed drawing tool; resets to 'none' once the drawing is placed. */
  const [tool, setTool] = useState<DrawTool>('none');
  const fibMode = tool === 'fib';
  const [fibFirstClick, setFibFirstClick] = useState<{ price: number; time: number } | null>(null);
  /** Line whose label is being typed, with the y of its line in the chart area. */
  const [editingLine, setEditingLine] = useState<{ id: string; y: number; text: string } | null>(null);
  const drawLines = useDrawingStore(s => s.lines);
  const drawFibs = useDrawingStore(s => s.fibs);
  const addLine = useDrawingStore(s => s.addLine);
  const moveLine = useDrawingStore(s => s.moveLine);
  const setLineText = useDrawingStore(s => s.setLineText);
  const removeLine = useDrawingStore(s => s.removeLine);
  const addFib = useDrawingStore(s => s.addFib);
  const removeFib = useDrawingStore(s => s.removeFib);
  const clearDrawings = useDrawingStore(s => s.clearAsset);
  /** Candles as plotted (deduped, sorted), real UTC ms; index-aligned with the series data. */
  const plottedRef = useRef<SnapshotCandle[]>([]);
  /** asset|interval the plotted candles belong to; stale bars stay on the series while a new asset loads. */
  const plottedKeyRef = useRef('');
  const aiPrimitivesRef = useRef<Map<string, AiOverlayPrimitive>>(new Map());
  const aiSets = useAiOverlayStore(s => s.sets);
  const aiEnabledIds = useAiOverlayStore(s => s.enabledIds);
  const alerts = useAlertStore(s => s.alerts);
  const alertPrimRef = useRef<AiOverlayPrimitive | null>(null);

  const pane = useMarketStore(s => s.panes[paneId]);
  const activePaneId = useMarketStore(s => s.activePaneId);
  const setActivePane = useMarketStore(s => s.setActivePane);
  const splitView = useMarketStore(s => s.splitView);
  const candles = pane?.candles ?? [];
  const currentAsset = pane?.asset ?? 'BTC';
  const interval = pane?.interval ?? '5m';
  const gexLevelPrimRef = useRef<AiOverlayPrimitive | null>(null);
  const gexPrimRef = useRef<GexPrimitive | null>(null);
  const gexLevelsOn = useGexStore(s => s.levels);
  const gexStrikes = useGexStore(s => s.strikes);
  const gexTicker = useGexFeed(currentAsset);
  const gexData = useGexStore(s => (gexTicker ? s.current(gexTicker) : undefined));
  const gexOffset = useGexStore(s => (gexTicker ? s.offsetFor(gexTicker) : 0));
  const setInterval = useMarketStore(s => s.setInterval);
  const loadCandles = useMarketStore(s => s.loadCandles);
  const loadMoreCandles = useMarketStore(s => s.loadMoreCandles);
  const mode = useSettingsStore(s => s.mode);
  const up = useThemeStore(s => s.up);
  const down = useThemeStore(s => s.down);
  const showGrid = useThemeStore(s => s.showGrid);
  const chartBg = useThemeStore(s => s.chartBg);
  const paperPositions = useAccountStore(s => s.paperPositions);
  const paperOrders = useAccountStore(s => s.paperOrders);
  const livePositions = useLiveAccountStore(s => s.positions);
  const liveOrders = useLiveAccountStore(s => s.openOrders);
  const activeSetups = useTradeSetupStore(s => s.activeSetups);
  const pendingSetup = useTradeSetupStore(s => s.pendingSetup);
  const addClick = useTradeSetupStore(s => s.addClick);
  const startSetupAt = useTradeSetupStore(s => s.startSetupAt);
  const updateSetup = useTradeSetupStore(s => s.updateSetup);
  const removeSetup = useTradeSetupStore(s => s.removeSetup);
  const requestExecute = useTradeSetupStore(s => s.requestExecute);
  const executeOutcome = useTradeSetupStore(s => s.executeOutcome);
  // The last Execute's result shows in the hint slot for a few seconds, on the active pane.
  const [showOutcome, setShowOutcome] = useState(false);
  useEffect(() => {
    if (!executeOutcome) return;
    setShowOutcome(true);
    const t = setTimeout(() => setShowOutcome(false), 4000);
    return () => clearTimeout(t);
  }, [executeOutcome]);
  const clearPending = useTradeSetupStore(s => s.clearPending);

  const isActive = activePaneId === paneId;
  const outcome = showOutcome && isActive ? executeOutcome : null;

  // Setups belonging to this pane, on the asset it charts now
  const paneSetups = activeSetups.filter(s => (s.paneId ?? 'primary') === paneId && s.asset === currentAsset);
  // Draggable order lines: paper orders, and live TP/SL triggers and resting limits (moved with batchModify).
  const [liveMoves, setLiveMoves] = useState<Record<number, { px: number; from: string }>>({});
  const [orderMsg, setOrderMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const paneOrders: LineOrder[] = mode === 'paper'
    ? paperOrders.filter(o => o.coin === currentAsset)
    : liveLineOrders(liveOrders, currentAsset, liveMoves);
  // User drawings on the asset this pane charts (shared by both panes when they show the same asset)
  const paneLines = useMemo(() => drawLines.filter(l => l.asset === currentAsset), [drawLines, currentAsset]);
  const paneFibs = useMemo(() => drawFibs.filter(f => f.asset === currentAsset), [drawFibs, currentAsset]);
  const paneFibsRef = useRef(paneFibs);
  paneFibsRef.current = paneFibs;
  const paneLinesRef = useRef(paneLines);
  paneLinesRef.current = paneLines;

  // Create chart — only once
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: useThemeStore.getState().chartBg },
        textColor: '#8a8f98',
      },
      grid: {
        vertLines: { color: '#1a1f2e', visible: useThemeStore.getState().showGrid },
        horzLines: { color: '#1a1f2e', visible: useThemeStore.getState().showGrid },
      },
      crosshair: { mode: 0 },
      timeScale: { borderColor: '#2a2f3e', timeVisible: true },
      rightPriceScale: { borderColor: '#2a2f3e' },
    });

    const series = chart.addCandlestickSeries({
      ...candleColors(upColor(), downColor()),
    });

    // Hyperliquid volume per bar, on its own overlay scale along the bottom fifth of the pane
    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;

    const sessionPrim = new SessionPrimitive();
    series.attachPrimitive(sessionPrim);
    sessionPrimitiveRef.current = sessionPrim;

    const fibPrim = new FibPrimitive();
    series.attachPrimitive(fibPrim);
    fibPrimitiveRef.current = fibPrim;

    const onResize = () => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
      tradeBoxPrimitivesRef.current.clear();
      orderLinePrimitivesRef.current.clear();
      hlinePrimitivesRef.current.clear();
      aiPrimitivesRef.current.clear();
      alertPrimRef.current = null;
      sessionPrimitiveRef.current = null;
      fibPrimitiveRef.current = null;
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    const seen = new Set<number>();
    const raw: CandlestickData[] = [];
    const plotted: SnapshotCandle[] = [];
    for (const c of candles) {
      const tUtc = Math.floor(c.t / 1000);
      const t = utcToChartTime(tUtc);
      if (seen.has(t)) continue;
      seen.add(t);
      const o = parseFloat(c.o);
      const h = parseFloat(c.h);
      const l = parseFloat(c.l);
      const cl = parseFloat(c.c);
      if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(cl)) continue;
      raw.push({ time: t as Time, open: o, high: h, low: l, close: cl });
      plotted.push({ t: tUtc * 1000, et: '', o, h, l, c: cl, v: parseFloat(c.v) || 0 });
    }
    // Sort by chart time and keep `plotted` index-aligned with `data`.
    const order = raw.map((_, i) => i).sort((a, b) => (raw[a].time as number) - (raw[b].time as number));
    const data = order.map(i => raw[i]);
    plottedRef.current = order.map(i => plotted[i]);
    plottedKeyRef.current = `${currentAsset}|${interval}`;

    try {
      seriesRef.current.setData(data);
    } catch (e) {
      console.warn('Chart setData error:', e);
    }
    try {
      volumeSeriesRef.current?.setData(plottedRef.current.map((c, i): HistogramData => ({
        time: data[i].time,
        value: c.v,
        color: withAlpha(c.c >= c.o ? up : down, 0.35),
      })));
    } catch (e) {
      console.warn('Chart volume setData error:', e);
    }

    sessionPrimitiveRef.current?.setCandleData(data);
  }, [candles, up, down]);

  // Settings: candle colours and grid. applyOptions also repaints the primitives, which read the colours at draw time.
  useEffect(() => {
    seriesRef.current?.applyOptions(candleColors(up, down));
    chartRef.current?.applyOptions({
      layout: { background: { color: chartBg } },
      grid: { vertLines: { visible: showGrid }, horzLines: { visible: showGrid } },
    });
  }, [up, down, showGrid, chartBg]);

  useEffect(() => {
    volumeSeriesRef.current?.applyOptions({ visible: volumeOn });
    try { localStorage.setItem(VOLUME_KEY, volumeOn ? '1' : '0'); } catch {}
  }, [volumeOn]);

  useEffect(() => {
    try { localStorage.setItem(TOOLBOX_KEY, toolboxOpen ? '1' : '0'); } catch {}
  }, [toolboxOpen]);

  // Fibs for this asset, from the drawing store (UTC ms) into chart time for the primitive
  useEffect(() => {
    fibPrimitiveRef.current?.setFibs(paneFibs.map(f => ({
      id: f.id, p1: f.p1, p2: f.p2,
      t1: utcToChartTime(Math.floor(f.t1 / 1000)),
      t2: utcToChartTime(Math.floor(f.t2 / 1000)),
    })));
  }, [paneFibs]);

  // One draggable primitive per horizontal line on this asset
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const primMap = hlinePrimitivesRef.current;
    const ids = new Set(paneLines.map(l => l.id));
    for (const [id, prim] of primMap) {
      if (!ids.has(id)) { series.detachPrimitive(prim); primMap.delete(id); }
    }
    const cb = { onMove: moveLine, onRemove: removeLine };
    for (const line of paneLines) {
      const existing = primMap.get(line.id);
      if (existing) { existing.update(line); existing.updateCallbacks(cb); }
      else { const prim = new HLinePrimitive(line, cb); series.attachPrimitive(prim); primMap.set(line.id, prim); }
    }
  }, [paneLines, moveLine, removeLine]);

  // Load more candles when scrolling to the left edge
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      if (range.from < 5) {
        loadMoreCandles(paneId);
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [loadMoreCandles, paneId]);

  // Draw order / position / draft price lines
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      try { series.removePriceLine(line); } catch {}
    }
    priceLinesRef.current = [];

    if (mode === 'paper') {
      for (const pos of paperPositions) {
        if (pos.coin !== currentAsset) continue;
        const isLong = pos.szi.gt(0);
        const upnl = pos.unrealizedPnl.toNumber();
        const upnlStr = upnl >= 0 ? `+$${upnl.toFixed(2)}` : `-$${Math.abs(upnl).toFixed(2)}`;
        try {
          priceLinesRef.current.push(series.createPriceLine({
            price: pos.entryPx.toNumber(),
            color: isLong ? up : down,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `${isLong ? 'LONG' : 'SHORT'} ${pos.szi.abs().toString()} @ ${pos.entryPx.toFixed(1)}  ${upnlStr}`,
          }));

          const liqPx = engine.getLiquidationPrice(pos.coin);
          if (liqPx) {
            priceLinesRef.current.push(series.createPriceLine({
              price: liqPx.toNumber(),
              color: down,
              lineWidth: 1,
              lineStyle: LineStyle.SparseDotted,
              axisLabelVisible: true,
              title: 'LIQ',
            }));
          }
        } catch {}
      }
    }

    if (mode === 'live') {
      for (const pos of livePositions) {
        if (pos.coin !== currentAsset) continue;
        const isLong = pos.szi > 0;
        const upnl = pos.unrealizedPnl;
        const upnlStr = upnl >= 0 ? `+$${upnl.toFixed(2)}` : `-$${Math.abs(upnl).toFixed(2)}`;
        try {
          priceLinesRef.current.push(series.createPriceLine({
            price: pos.entryPx,
            color: isLong ? up : down,
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `LIVE ${isLong ? 'LONG' : 'SHORT'} ${Math.abs(pos.szi)} @ ${pos.entryPx}  ${upnlStr}`,
          }));
          if (pos.liquidationPx) {
            priceLinesRef.current.push(series.createPriceLine({
              price: pos.liquidationPx,
              color: down,
              lineWidth: 1,
              lineStyle: LineStyle.SparseDotted,
              axisLabelVisible: true,
              title: 'LIQ',
            }));
          }
        } catch {}
      }
      for (const o of liveOrders) {
        if (o.coin !== currentAsset || isLiveDraggable(o)) continue;
        const px = parseFloat(o.isTrigger ? o.triggerPx : o.limitPx);
        if (!(px > 0)) continue;
        try {
          priceLinesRef.current.push(series.createPriceLine({
            price: px,
            color: o.side === 'buy' ? up : down,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${o.orderType} ${o.side.toUpperCase()} ${o.sz}`,
          }));
        } catch {}
      }
    }

    if (fibFirstClick !== null) {
      try {
        priceLinesRef.current.push(series.createPriceLine({
          price: fibFirstClick.price,
          color: 'rgba(255, 255, 255, 0.4)',
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: true,
          title: 'Fib ●',
        }));
      } catch {}
    }

    // Pending setup click markers — only on the active pane (where it's being drawn)
    if (pendingSetup && isActive) {
      const color = pendingSetup.side === 'buy' ? up : down;
      for (const clickPrice of pendingSetup.clicks) {
        try {
          priceLinesRef.current.push(series.createPriceLine({
            price: clickPrice,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.SparseDotted,
            axisLabelVisible: true,
            title: `● ${clickPrice.toFixed(2)}`,
          }));
        } catch {}
      }
    }
  }, [mode, paperPositions, livePositions, liveOrders, pendingSetup, currentAsset, fibFirstClick, isActive, engine, up, down]);

  // Mouse down: pane becomes active, then handle trade box / fib / setup clicks / alt+click alert
  const handleChartClick = useCallback((e: React.MouseEvent) => {
    if (!seriesRef.current) return;

    if (activePaneId !== paneId) {
      setActivePane(paneId);
    }

    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const price = seriesRef.current.coordinateToPrice(y);
    if (price === null || price === undefined) return;
    const priceNum = Number(price);

    // alt+click on a drawn line arms the alert at the line's exact price (alt+ctrl: on this interval's close)
    if (e.altKey) {
      const hit = [...hlinePrimitivesRef.current.values()].find(p => p.hitLine(x, y));
      if (hit) {
        e.preventDefault();
        void useAlertStore.getState().add({
          asset: currentAsset,
          kind: e.ctrlKey ? 'close' : 'cross',
          interval: e.ctrlKey ? interval : undefined,
          level: snapPrice(hit.line.price),
          note: hit.line.text,
        });
        return;
      }
    }

    for (const prim of tradeBoxPrimitivesRef.current.values()) {
      if (prim.handleButtonClick(x, y)) return;
    }

    if (tool === 'none' && !e.shiftKey && !e.ctrlKey) {
      for (const prim of hlinePrimitivesRef.current.values()) {
        if (prim.handleMouseDown(x, y)) {
          if (prim.isDragging) chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
          return;
        }
      }
      const fibId = fibPrimitiveRef.current?.handleMouseDown(x, y);
      if (fibId) { removeFib(fibId); return; }
    }

    for (const prim of tradeBoxPrimitivesRef.current.values()) {
      if (prim.handleMouseDown(x, y)) {
        chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
        return;
      }
    }

    for (const prim of orderLinePrimitivesRef.current.values()) {
      if (prim.handleMouseDown(x, y)) {
        chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
        return;
      }
    }

    if (fibMode && chartRef.current) {
      const clickTime = chartRef.current.timeScale().coordinateToTime(x);
      if (clickTime === null) return;
      const timeNum = clickTime as number;

      if (fibFirstClick === null) {
        setFibFirstClick({ price: priceNum, time: timeNum });
      } else {
        addFib(currentAsset, {
          p1: fibFirstClick.price,
          p2: priceNum,
          t1: chartTimeToUtc(fibFirstClick.time) * 1000,
          t2: chartTimeToUtc(timeNum) * 1000,
        });
        setFibFirstClick(null);
        setTool('none');
      }
      return;
    }

    // Line tool, or ctrl+click without the tool: a horizontal line at the clicked price
    if (tool === 'line' || (e.ctrlKey && !e.shiftKey && !e.altKey)) {
      e.preventDefault();
      addLine(currentAsset, snapPrice(priceNum));
      setTool('none');
      return;
    }

    // shift+click starts a long setup with the entry at the clicked price; ctrl+shift+click a short.
    // Two more plain clicks place SL and TP. Shift+click during a pending setup restarts it here.
    if (e.shiftKey) {
      e.preventDefault();
      startSetupAt(
        e.ctrlKey ? 'sell' : 'buy',
        priceNum,
        chartRef.current ? chartXToTime(chartRef.current, seriesRef.current, x) : null,
        { paneId, asset: currentAsset },
      );
      return;
    }

    const pending = useTradeSetupStore.getState().pendingSetup;
    if (pending) {
      addClick(
        priceNum,
        chartRef.current ? chartXToTime(chartRef.current, seriesRef.current, x) : null,
        { paneId, asset: currentAsset },
      );
      return;
    }

    // alt+click arms a price alert at the clicked price (alt+ctrl: on this interval's close)
    if (e.altKey) {
      e.preventDefault();
      void useAlertStore.getState().add({
        asset: currentAsset,
        kind: e.ctrlKey ? 'close' : 'cross',
        interval: e.ctrlKey ? interval : undefined,
        // Hyperliquid prices carry at most 5 significant figures.
        level: Number(priceNum.toPrecision(5)),
      });
    }
  }, [currentAsset, addClick, startSetupAt, interval, tool, fibMode, fibFirstClick, addFib, addLine, removeFib, activePaneId, paneId, setActivePane]);

  // Double-click on a drawn line opens its label for typing
  const handleChartDoubleClick = useCallback((e: React.MouseEvent) => {
    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect || !seriesRef.current) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = [...hlinePrimitivesRef.current.values()].find(p => p.hitLine(x, y));
    if (!hit) return;
    e.preventDefault();
    const lineY = seriesRef.current.priceToCoordinate(hit.line.price);
    setEditingLine({ id: hit.line.id, y: lineY ?? y, text: hit.line.text ?? '' });
  }, []);

  const commitLineText = useCallback(() => {
    if (editingLine) setLineText(editingLine.id, editingLine.text);
    setEditingLine(null);
  }, [editingLine, setLineText]);

  // Manage trade box primitives — only ones belonging to this pane
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const primMap = tradeBoxPrimitivesRef.current;
    const activeIds = new Set(paneSetups.map(s => s.id));

    for (const [id, prim] of primMap) {
      if (!activeIds.has(id)) {
        series.detachPrimitive(prim);
        primMap.delete(id);
      }
    }

    for (const setup of paneSetups) {
      const existing = primMap.get(setup.id);
      if (existing) {
        existing.updateSetup(setup);
        existing.updateCallbacks(requestExecute, removeSetup, updateSetup);
      } else {
        const prim = new TradeBoxPrimitive(
          setup,
          requestExecute,
          removeSetup,
          updateSetup,
        );
        series.attachPrimitive(prim);
        primMap.set(setup.id, prim);
      }
    }
  }, [paneSetups, requestExecute, removeSetup, updateSetup]);

  // A moved live order is drawn at its new price until the account refresh shows the change.
  useEffect(() => {
    setLiveMoves(m => {
      const keep = Object.entries(m).filter(([oid, mv]) => liveOrders.some(o => o.oid === Number(oid) && liveLinePx(o) === mv.from));
      return keep.length === Object.keys(m).length ? m : Object.fromEntries(keep);
    });
  }, [liveOrders]);

  useEffect(() => {
    if (!orderMsg) return;
    const t = window.setTimeout(() => setOrderMsg(null), orderMsg.ok ? 4000 : 10000);
    return () => window.clearTimeout(t);
  }, [orderMsg]);

  const handleOrderDragDone = useCallback((orderId: string, newPrice: number) => {
    if (orderId.startsWith('live-')) {
      const oid = Number(orderId.slice(5));
      const live = useLiveAccountStore.getState().openOrders.find(o => o.oid === oid);
      if (!live || !(newPrice > 0)) return;
      // A click without a move drops at the same price; nothing to send.
      const from = liveLinePx(live);
      if (Math.abs(newPrice - parseFloat(from)) < 1e-9 * newPrice) return;
      setLiveMoves(m => ({ ...m, [oid]: { px: newPrice, from } }));
      const trigger = isLiveTrigger(live);
      void (trigger ? modifyLiveTrigger(live, newPrice) : modifyLiveLimit(live, newPrice)).then(r => {
        const what = trigger ? triggerKind(live.orderType)?.toUpperCase() ?? 'Order' : 'Limit';
        setOrderMsg({ ok: r.ok, text: r.ok ? r.message : `${what} not moved: ${r.message}` });
        if (!r.ok) setLiveMoves(m => { const { [oid]: _, ...rest } = m; return rest; });
      });
      return;
    }
    const ord = paperOrders.find(o => o.id === orderId);
    if (!ord) return;

    // Cancelling the entry also cancels its TP/SL; re-attach them to the moved entry below.
    const children = paperOrders.filter(o => o.parentOid === orderId);
    engine.cancelOrder(orderId);

    const isLimit = ord.type === 'limit';
    const orderType: import('../../types/order.ts').OrderType = isLimit
      ? { limit: { tif: 'Gtc' as const } }
      : {
          trigger: {
            isMarket: ord.isMarket ?? true,
            triggerPx: newPrice.toFixed(2),
            tpsl: ord.tpsl ?? ('sl' as const),
          },
        };

    const placed = engine.placeOrder({
      coin: ord.coin,
      side: ord.side,
      price: isLimit ? newPrice.toFixed(2) : ord.price.toString(),
      size: ord.size.toString(),
      reduceOnly: ord.reduceOnly,
      orderType,
      ...(ord.parentOid ? { parentOid: ord.parentOid } : {}),
    });
    if (!placed.success) return;
    for (const c of children) {
      engine.placeOrder({
        coin: c.coin,
        side: c.side,
        price: c.price.toString(),
        size: c.size.toString(),
        reduceOnly: c.reduceOnly,
        orderType: { trigger: { isMarket: c.isMarket ?? true, triggerPx: c.triggerPx!.toString(), tpsl: c.tpsl ?? 'sl' } },
        parentOid: String(placed.oid),
      });
    }
  }, [engine, paperOrders]);

  // Manage order line primitives — only orders for this pane's asset
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const primMap = orderLinePrimitivesRef.current;
    const currentOrderIds = new Set(paneOrders.map(o => o.id));

    for (const [id, prim] of primMap) {
      if (!currentOrderIds.has(id)) {
        series.detachPrimitive(prim);
        primMap.delete(id);
      }
    }

    for (const ord of paneOrders) {
      const existing = primMap.get(ord.id);
      if (existing) {
        existing.updateOrder(ord);
        existing.updateCallback(handleOrderDragDone);
      } else {
        const prim = new OrderLinePrimitive(ord, handleOrderDragDone);
        series.attachPrimitive(prim);
        primMap.set(ord.id, prim);
      }
    }
  }, [paneOrders, handleOrderDragDone]);

  // AI overlay sets: one primitive per toggled-on set for this pane's asset
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const primMap = aiPrimitivesRef.current;
    const wanted = new Map(
      aiSets.filter(s => aiEnabledIds.includes(s.id) && s.asset === currentAsset).map(s => [s.id, s]),
    );

    for (const [id, prim] of primMap) {
      if (!wanted.has(id)) {
        prim.requestRedraw();
        series.detachPrimitive(prim);
        primMap.delete(id);
      }
    }
    for (const [id, set] of wanted) {
      const existing = primMap.get(id);
      if (existing) {
        if (existing.set !== set) existing.setSet(set);
      } else {
        const prim = new AiOverlayPrimitive(set);
        series.attachPrimitive(prim);
        primMap.set(id, prim);
      }
    }
  }, [aiSets, aiEnabledIds, currentAsset]);

  // Armed price alerts for this asset: one dashed line each while the Alerts toggle is on
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const lines = alertsOn ? alerts.filter(a => a.asset === currentAsset && a.status === 'armed').map(alertLine) : [];
    const prim = alertPrimRef.current;
    if (lines.length === 0) {
      if (prim) { prim.requestRedraw(); series.detachPrimitive(prim); alertPrimRef.current = null; }
      return;
    }
    const set: OverlaySet = { id: '__alerts', batch: '__alerts', name: 'Alerts', asset: currentAsset, color: '#f0b90b', createdAt: 0, shapes: lines };
    if (prim) prim.setSet(set);
    else { const p = new AiOverlayPrimitive(set); series.attachPrimitive(p); alertPrimRef.current = p; }
  }, [alerts, alertsOn, currentAsset]);

  // GEX levels for this asset's options: zero gamma and the major strikes as labelled lines
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const prim = gexLevelPrimRef.current;
    if (!gexLevelsOn || !gexData) {
      if (prim) { prim.requestRedraw(); series.detachPrimitive(prim); gexLevelPrimRef.current = null; }
      return;
    }
    const set = gexLevelSet(currentAsset, gexData, interval, gexOffset);
    if (prim) prim.setSet(set);
    else { const p = new AiOverlayPrimitive(set); series.attachPrimitive(p); gexLevelPrimRef.current = p; }
  }, [gexLevelsOn, gexData, gexOffset, currentAsset, interval, up, down]);

  // GEX strike profile: bars off the price axis, behind the candles
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const prim = gexPrimRef.current;
    if (gexStrikes === 'off' || !gexData) {
      if (prim) { prim.requestRedraw(); series.detachPrimitive(prim); gexPrimRef.current = null; }
      return;
    }
    const profile = { data: gexData, mode: gexStrikes, offset: gexOffset, priorSlots: lookbacksFor(interval).map(l => l.slot), priorLabels: lookbacksFor(interval).map(l => lookbackLabel(l.minutes)) };
    if (prim) prim.setProfile(profile);
    else { const p = new GexPrimitive(profile); series.attachPrimitive(p); gexPrimRef.current = p; }
  }, [gexStrikes, gexData, gexOffset, currentAsset, interval]);


  // Each pane answers AI snapshot requests with what is actually on screen; the
  // active one becomes the snapshot's main view, the other is listed under `panes`.
  useEffect(() => {
    return registerSnapshotProvider(paneId, () => {
      const chart = chartRef.current;
      // Bars of the previous asset/interval are not this pane's until the new candles plot.
      const plotted = plottedKeyRef.current === `${currentAsset}|${interval}` ? plottedRef.current : [];
      const range = chart?.timeScale().getVisibleLogicalRange() ?? null;
      let from = 0;
      let to = plotted.length - 1;
      if (range && plotted.length > 0) {
        from = Math.max(0, Math.min(plotted.length - 1, Math.floor(range.from)));
        to = Math.max(0, Math.min(plotted.length - 1, Math.ceil(range.to)));
      }
      const bars = plotted.length > 0 && to >= from ? to - from + 1 : 0;
      const start = Math.max(from, to - SNAPSHOT_MAX_BARS + 1);
      const slice = bars > 0 ? plotted.slice(start, to + 1).map(c => ({ ...c, et: formatEt(c.t) })) : [];
      return {
        pane: paneId,
        asset: currentAsset,
        interval,
        visible: bars > 0 ? { from: plotted[from].t, to: plotted[to].t, bars } : { from: 0, to: 0, bars: 0 },
        candles: slice,
        fibs: paneFibsRef.current.map(f => ({ id: f.id, p1: f.p1, p2: f.p2, t1: f.t1, t2: f.t2 })),
        lines: paneLinesRef.current.map(l => ({ id: l.id, price: l.price, ...(l.text ? { text: l.text } : {}) })),
      };
    });
  }, [paneId, currentAsset, interval]);

  const handleChartMouseMove = useCallback((e: React.MouseEvent) => {
    if (!seriesRef.current) return;

    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const price = seriesRef.current.coordinateToPrice(y);
    if (price === null || price === undefined) return;
    const priceNum = Number(price);

    for (const prim of tradeBoxPrimitivesRef.current.values()) {
      if (prim.handleMouseMove(priceNum)) return;
    }

    for (const prim of orderLinePrimitivesRef.current.values()) {
      if (prim.handleMouseMove(priceNum)) return;
    }

    for (const prim of hlinePrimitivesRef.current.values()) {
      if (prim.handleMouseMove(priceNum)) return;
    }
  }, []);

  const handleChartMouseUp = useCallback(() => {
    for (const prim of tradeBoxPrimitivesRef.current.values()) {
      if (prim.handleMouseUp()) {
        chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
        return;
      }
    }

    for (const prim of orderLinePrimitivesRef.current.values()) {
      if (prim.handleMouseUp()) {
        chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
        return;
      }
    }

    for (const prim of hlinePrimitivesRef.current.values()) {
      if (prim.handleMouseUp()) {
        chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
        return;
      }
    }
  }, []);

  useEffect(() => {
    sessionPrimitiveRef.current?.setEnabled(sessionsOn);
  }, [sessionsOn]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearPending();
        setTool('none');
        setFibFirstClick(null);
        setEditingLine(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearPending, isActive]);

  const drawHint = tool === 'fib'
    ? (!fibFirstClick ? 'Click first fib point — ESC to cancel' : 'Click second fib point — ESC to cancel')
    : tool === 'line'
    ? 'Click to place a horizontal line — ESC to cancel'
    : null;

  // Border highlight when split view is on so user can see the active pane
  const borderColor = splitView && isActive ? '#3861fb' : 'transparent';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      border: `1px solid ${borderColor}`,
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', background: '#0d1117', alignItems: 'center' }}>
        {splitView && (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            color: isActive ? '#3861fb' : '#555',
            padding: '2px 6px',
            border: `1px solid ${isActive ? '#3861fb' : '#2a2f3e'}`,
            marginRight: 4,
          }}>
            {currentAsset}
          </span>
        )}
        {INTERVALS.map(iv => (
          <button
            key={iv}
            onClick={() => { setInterval(iv, paneId); loadCandles(paneId); }}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: iv === interval ? '#1a1f2e' : 'transparent',
              border: iv === interval ? '1px solid #2a2f3e' : '1px solid transparent',
              borderRadius: 4,
              color: iv === interval ? '#e1e4e8' : '#8a8f98',
              cursor: 'pointer',
            }}
          >
            {iv}
          </button>
        ))}
        <button
          onClick={() => setSessionsOn(v => !v)}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: sessionsOn ? '#1a1f2e' : 'transparent',
            border: sessionsOn ? '1px solid #2a2f3e' : '1px solid transparent',
            borderRadius: 4,
            color: sessionsOn ? '#e1e4e8' : '#8a8f98',
            cursor: 'pointer',
            marginLeft: 8,
          }}
        >
          KZ
        </button>
        <button
          onClick={() => setAlertsOn(v => !v)}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: alertsOn ? '#1a1f2e' : 'transparent',
            border: alertsOn ? '1px solid #2a2f3e' : '1px solid transparent',
            borderRadius: 4,
            color: alertsOn ? '#e1e4e8' : '#8a8f98',
            cursor: 'pointer',
          }}
        >
          Alerts
        </button>
        <button
          onClick={() => setVolumeOn(v => !v)}
          title="Volume traded per bar on this Hyperliquid market (not options volume)"
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: volumeOn ? '#1a1f2e' : 'transparent',
            border: volumeOn ? '1px solid #2a2f3e' : '1px solid transparent',
            borderRadius: 4,
            color: volumeOn ? '#e1e4e8' : '#8a8f98',
            cursor: 'pointer',
          }}
        >
          Vol
        </button>
        <button
          onClick={() => { setToolboxOpen(v => !v); setTool('none'); setFibFirstClick(null); }}
          title="Drawing tools: horizontal lines and fibs"
          style={toolbarButtonStyle(toolboxOpen)}
        >
          Draw
        </button>
        <GexToolbar ticker={gexTicker} interval={interval} />
        <span style={{ marginLeft: 'auto', fontSize: 11, color: outcome ? (outcome.ok ? 'var(--up)' : 'var(--down)') : tool !== 'none' ? '#e1e4e8' : (pendingSetup && isActive) ? (pendingSetup.side === 'buy' ? 'var(--up)' : 'var(--down)') : '#555', alignSelf: 'center' }}>
          {outcome
            ? outcome.message
            : tool !== 'none'
            ? drawHint
            : (pendingSetup && isActive)
            ? `${pendingSetup.entryFirst ? 'Entry set — click SL and TP' : `Click to place ${pendingSetup.side === 'buy' ? 'Long' : 'Short'} setup`} (${pendingSetup.clicks.length}/3) — ESC to cancel`
            : 'Shift+Click: long setup at entry · Ctrl+Shift+Click: short setup'}
        </span>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 300 }}>
        <div
          ref={chartContainerRef}
          style={{ position: 'absolute', inset: 0 }}
          onMouseDown={handleChartClick}
          onMouseMove={handleChartMouseMove}
          onMouseUp={handleChartMouseUp}
          onDoubleClick={handleChartDoubleClick}
        />
        {orderMsg && (
          <div
            data-testid="chart-order-msg"
            onClick={() => setOrderMsg(null)}
            style={{
              position: 'absolute', top: 8, left: 8, zIndex: 5, maxWidth: '60%', padding: '4px 8px', fontSize: 11,
              background: 'rgba(13,17,23,0.9)', border: `1px solid ${orderMsg.ok ? 'var(--up)' : 'var(--down)'}`,
              color: orderMsg.ok ? 'var(--up)' : 'var(--down)', cursor: 'pointer',
            }}
          >
            {orderMsg.text}
          </div>
        )}
        {toolboxOpen && (
          <DrawToolbox
            tool={tool}
            setTool={t => { setTool(t); setFibFirstClick(null); }}
            hint={tool !== 'none' ? drawHint : null}
            drawingCount={paneLines.length + paneFibs.length}
            onClear={() => clearDrawings(currentAsset)}
            onClose={() => { setToolboxOpen(false); setTool('none'); setFibFirstClick(null); }}
          />
        )}
        {editingLine && (
          <input
            autoFocus
            value={editingLine.text}
            placeholder="label"
            maxLength={40}
            onChange={e => setEditingLine(l => (l ? { ...l, text: e.target.value } : l))}
            onKeyDown={e => {
              if (e.key === 'Enter') commitLineText();
              else if (e.key === 'Escape') setEditingLine(null);
              e.stopPropagation();
            }}
            onBlur={commitLineText}
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: editingLine.y - 11,
              right: 80,
              zIndex: 6,
              width: 160,
              padding: '3px 6px',
              fontSize: 11,
              fontFamily: 'monospace',
              background: 'rgba(13, 17, 23, 0.95)',
              color: '#e1e4e8',
              border: '1px solid #a78bfa',
              borderRadius: 3,
              outline: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}

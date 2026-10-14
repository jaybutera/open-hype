import { useEffect, useRef, useCallback, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type Time, type IPriceLine, LineStyle } from 'lightweight-charts';
import { useMarketStore, type PaneId } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useLiveAccountStore } from '../../store/useLiveAccountStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useChartStore, type DraftOrder } from '../../store/useChartStore.ts';
import { useTradeSetupStore } from '../../store/useTradeSetupStore.ts';
import { TradeBoxPrimitive } from './TradeBoxPrimitive.ts';
import { OrderLinePrimitive } from './OrderLinePrimitive.ts';
import { SessionPrimitive } from './SessionPrimitive.ts';
import { FibPrimitive, type FibRetracement } from './FibPrimitive.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { CandleInterval } from '../../types/market.ts';
import { utcToChartTime, chartTimeToUtc, formatEt } from '../../utils/chartTime.ts';
import { AiOverlayPrimitive } from './AiOverlayPrimitive.ts';
import { useAiOverlayStore } from '../../store/useAiOverlayStore.ts';
import { registerSnapshotProvider } from '../../services/ai/link.ts';
import type { SnapshotCandle, OverlaySet } from '../../services/ai/types.ts';
import { useAlertStore } from '../../store/useAlertStore.ts';
import { alertLine } from '../../services/ai/alerts.ts';

/** Max candles a snapshot carries (the most recent visible ones). */
const SNAPSHOT_MAX_BARS = 600;

// Chart-time helpers live in utils/chartTime.ts; re-exported for existing importers.
export { getNyOffset, utcToChartTime, chartTimeToUtc } from '../../utils/chartTime.ts';

const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface Props {
  engine: PaperEngine;
  paneId?: PaneId;
}

export function TradingChart({ engine, paneId = 'primary' }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const tradeBoxPrimitivesRef = useRef<Map<string, TradeBoxPrimitive>>(new Map());
  const orderLinePrimitivesRef = useRef<Map<string, OrderLinePrimitive>>(new Map());
  const sessionPrimitiveRef = useRef<SessionPrimitive | null>(null);
  const fibPrimitiveRef = useRef<FibPrimitive | null>(null);
  const [sessionsOn, setSessionsOn] = useState(true);
  const [fibMode, setFibMode] = useState(false);
  const [fibFirstClick, setFibFirstClick] = useState<{ price: number; time: number } | null>(null);
  const [fibs, setFibs] = useState<FibRetracement[]>([]);
  const fibsRef = useRef<FibRetracement[]>([]);
  fibsRef.current = fibs;
  /** Candles as plotted (deduped, sorted), real UTC ms; index-aligned with the series data. */
  const plottedRef = useRef<SnapshotCandle[]>([]);
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
  const allMids = useMarketStore(s => s.allMids);
  const setInterval = useMarketStore(s => s.setInterval);
  const loadCandles = useMarketStore(s => s.loadCandles);
  const loadMoreCandles = useMarketStore(s => s.loadMoreCandles);
  const mode = useSettingsStore(s => s.mode);
  const paperPositions = useAccountStore(s => s.paperPositions);
  const paperOrders = useAccountStore(s => s.paperOrders);
  const livePositions = useLiveAccountStore(s => s.positions);
  const liveOrders = useLiveAccountStore(s => s.openOrders);
  const draftOrder = useChartStore(s => s.draftOrder);
  const setDraftOrder = useChartStore(s => s.setDraftOrder);
  const setShowConfirm = useChartStore(s => s.setShowConfirm);
  const setDragging = useChartStore(s => s.setDragging);
  const activeSetups = useTradeSetupStore(s => s.activeSetups);
  const pendingSetup = useTradeSetupStore(s => s.pendingSetup);
  const addClick = useTradeSetupStore(s => s.addClick);
  const updateSetup = useTradeSetupStore(s => s.updateSetup);
  const removeSetup = useTradeSetupStore(s => s.removeSetup);
  const clearPending = useTradeSetupStore(s => s.clearPending);

  const isActive = activePaneId === paneId;

  // Setups belonging to this pane
  const paneSetups = activeSetups.filter(s => (s.paneId ?? 'primary') === paneId);
  // Draggable order lines edit paper orders only; live orders are drawn as plain price lines.
  const paneOrders = mode === 'paper' ? paperOrders.filter(o => o.coin === currentAsset) : [];

  // Create chart — only once
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: '#0a0e17' },
        textColor: '#8a8f98',
      },
      grid: {
        vertLines: { color: '#1a1f2e' },
        horzLines: { color: '#1a1f2e' },
      },
      crosshair: { mode: 0 },
      timeScale: { borderColor: '#2a2f3e', timeVisible: true },
      rightPriceScale: { borderColor: '#2a2f3e' },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#0ecb81',
      downColor: '#f6465d',
      borderUpColor: '#0ecb81',
      borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81',
      wickDownColor: '#f6465d',
    });

    chartRef.current = chart;
    seriesRef.current = series;

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
      priceLinesRef.current = [];
      tradeBoxPrimitivesRef.current.clear();
      orderLinePrimitivesRef.current.clear();
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

    try {
      seriesRef.current.setData(data);
    } catch (e) {
      console.warn('Chart setData error:', e);
    }

    sessionPrimitiveRef.current?.setCandleData(data);
  }, [candles]);

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
            color: isLong ? '#0ecb81' : '#f6465d',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `${isLong ? 'LONG' : 'SHORT'} ${pos.szi.abs().toString()} @ ${pos.entryPx.toFixed(1)}  ${upnlStr}`,
          }));

          const liqPx = engine.getLiquidationPrice(pos.coin);
          if (liqPx) {
            priceLinesRef.current.push(series.createPriceLine({
              price: liqPx.toNumber(),
              color: '#ff4444',
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
            color: isLong ? '#0ecb81' : '#f6465d',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `LIVE ${isLong ? 'LONG' : 'SHORT'} ${Math.abs(pos.szi)} @ ${pos.entryPx}  ${upnlStr}`,
          }));
          if (pos.liquidationPx) {
            priceLinesRef.current.push(series.createPriceLine({
              price: pos.liquidationPx,
              color: '#ff4444',
              lineWidth: 1,
              lineStyle: LineStyle.SparseDotted,
              axisLabelVisible: true,
              title: 'LIQ',
            }));
          }
        } catch {}
      }
      for (const o of liveOrders) {
        if (o.coin !== currentAsset) continue;
        const px = parseFloat(o.isTrigger ? o.triggerPx : o.limitPx);
        if (!(px > 0)) continue;
        try {
          priceLinesRef.current.push(series.createPriceLine({
            price: px,
            color: o.side === 'buy' ? '#0ecb81' : '#f6465d',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${o.orderType} ${o.side.toUpperCase()} ${o.sz}`,
          }));
        } catch {}
      }
    }

    // Only show draft order on the active pane (it belongs to the OrderPanel)
    if (draftOrder && isActive) {
      try {
        priceLinesRef.current.push(series.createPriceLine({
          price: draftOrder.price,
          color: draftOrder.side === 'buy' ? '#0ecb81' : '#f6465d',
          lineWidth: 2,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: true,
          title: `${draftOrder.type.toUpperCase()} ${draftOrder.side.toUpperCase()} @ ${draftOrder.price.toFixed(2)}`,
        }));
      } catch {}
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
      const color = pendingSetup.side === 'buy' ? '#0ecb81' : '#f6465d';
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
  }, [mode, paperPositions, livePositions, liveOrders, draftOrder, pendingSetup, currentAsset, fibFirstClick, isActive, engine]);

  // Mouse down: pane becomes active, then handle trade box / setup / shift+click
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
        const newFib: FibRetracement = {
          id: `fib-${Date.now()}`,
          p1: fibFirstClick.price,
          p2: priceNum,
          t1: fibFirstClick.time,
          t2: timeNum,
        };
        const updated = [...fibs, newFib];
        setFibs(updated);
        fibPrimitiveRef.current?.setFibs(updated);
        setFibFirstClick(null);
        setFibMode(false);
      }
      return;
    }

    const pending = useTradeSetupStore.getState().pendingSetup;
    if (pending) {
      addClick(priceNum);
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
      return;
    }

    if (!e.shiftKey) return;

    const mid = parseFloat(allMids[currentAsset] ?? '0');
    void mid;
    const { mode: currentMode } = useSettingsStore.getState();
    const livePos = useLiveAccountStore.getState().positions.find(p => p.coin === currentAsset);
    const paperPos = paperPositions.find(p => p.coin === currentAsset);
    const pos = currentMode === 'live'
      ? (livePos ? { isLong: livePos.szi > 0, entryPx: livePos.entryPx } : null)
      : (paperPos && !paperPos.szi.isZero() ? { isLong: paperPos.szi.gt(0), entryPx: paperPos.entryPx.toNumber() } : null);

    let draft: DraftOrder;

    if (pos) {
      const { isLong, entryPx } = pos;
      const isTp = isLong ? priceNum > entryPx : priceNum < entryPx;

      draft = {
        side: isLong ? 'sell' : 'buy',
        type: isTp ? 'tp' : 'stop',
        price: priceNum,
        tpsl: isTp ? 'tp' : 'sl',
      };
    } else {
      const { side } = useSettingsStore.getState();
      draft = { side, type: 'limit', price: priceNum };
    }

    const { sizeUsdc } = useSettingsStore.getState();
    // Live orders always go through the confirm modal; only paper orders skip it.
    if (currentMode === 'paper' && sizeUsdc && parseFloat(sizeUsdc) > 0) {
      placeFromDraft(draft, sizeUsdc, priceNum);
    } else {
      setDraftOrder(draft);
      setShowConfirm(true);
    }
  }, [allMids, currentAsset, paperPositions, setDraftOrder, setShowConfirm, addClick, fibMode, fibFirstClick, fibs, activePaneId, paneId, setActivePane]);

  const placeFromDraft = useCallback((draft: DraftOrder, sizeUsdc: string, priceNum: number) => {
    const isReduceOnly = draft.type === 'tp' || draft.type === 'stop';

    let assetSize: string;
    if (isReduceOnly) {
      const pos = engine.getPosition(currentAsset);
      assetSize = pos ? pos.szi.abs().toString() : (parseFloat(sizeUsdc) / priceNum).toString();
    } else {
      assetSize = (parseFloat(sizeUsdc) / priceNum).toString();
    }

    let orderType: import('../../types/order.ts').OrderType;
    if (draft.type === 'limit') {
      orderType = { limit: { tif: 'Gtc' as const } };
    } else {
      orderType = {
        trigger: {
          isMarket: true,
          triggerPx: priceNum.toFixed(2),
          tpsl: draft.tpsl ?? (draft.type === 'tp' ? 'tp' as const : 'sl' as const),
        },
      };
    }

    engine.placeOrder({
      coin: currentAsset,
      side: draft.side,
      price: priceNum.toFixed(2),
      size: assetSize,
      reduceOnly: isReduceOnly,
      orderType,
    });
  }, [engine, currentAsset]);

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
        existing.updateCallbacks(removeSetup, updateSetup);
      } else {
        const noop = () => {};
        const prim = new TradeBoxPrimitive(
          setup,
          noop,
          removeSetup,
          updateSetup,
        );
        series.attachPrimitive(prim);
        primMap.set(setup.id, prim);
      }
    }
  }, [paneSetups, removeSetup, updateSetup]);

  const handleOrderDragDone = useCallback((orderId: string, newPrice: number) => {
    const ord = paperOrders.find(o => o.id === orderId);
    if (!ord) return;

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

    engine.placeOrder({
      coin: ord.coin,
      side: ord.side,
      price: isLimit ? newPrice.toFixed(2) : ord.price.toString(),
      size: ord.size.toString(),
      reduceOnly: ord.reduceOnly,
      orderType,
    });
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

  // Armed price alerts for this asset: one always-on dashed line each
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const lines = alerts.filter(a => a.asset === currentAsset && a.status === 'armed').map(alertLine);
    const prim = alertPrimRef.current;
    if (lines.length === 0) {
      if (prim) { prim.requestRedraw(); series.detachPrimitive(prim); alertPrimRef.current = null; }
      return;
    }
    const set: OverlaySet = { id: '__alerts', batch: '__alerts', name: 'Alerts', asset: currentAsset, color: '#f0b90b', createdAt: 0, shapes: lines };
    if (prim) prim.setSet(set);
    else { const p = new AiOverlayPrimitive(set); series.attachPrimitive(p); alertPrimRef.current = p; }
  }, [alerts, currentAsset]);

  // The active pane answers AI snapshot requests with what is actually on screen
  useEffect(() => {
    if (!isActive) return;
    return registerSnapshotProvider(() => {
      const chart = chartRef.current;
      const plotted = plottedRef.current;
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
        fibs: fibsRef.current.map(f => ({
          id: f.id, p1: f.p1, p2: f.p2,
          t1: chartTimeToUtc(f.t1) * 1000,
          t2: chartTimeToUtc(f.t2) * 1000,
        })),
      };
    });
  }, [isActive, paneId, currentAsset, interval]);

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

    const { draftOrder: draft, isDragging } = useChartStore.getState();
    if (!isDragging || !draft) return;
    setDraftOrder({ ...draft, price: priceNum });
  }, [setDraftOrder]);

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

    const draft = useChartStore.getState().draftOrder;
    if (draft) {
      setDragging(false);
      setShowConfirm(true);
    }
  }, [setDragging, setShowConfirm]);

  useEffect(() => {
    sessionPrimitiveRef.current?.setEnabled(sessionsOn);
  }, [sessionsOn]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearPending();
        setFibMode(false);
        setFibFirstClick(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearPending, isActive]);

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
          onClick={() => { setFibMode(v => !v); setFibFirstClick(null); }}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: fibMode ? '#1a1f2e' : 'transparent',
            border: fibMode ? '1px solid #2a2f3e' : '1px solid transparent',
            borderRadius: 4,
            color: fibMode ? '#e1e4e8' : '#8a8f98',
            cursor: 'pointer',
          }}
        >
          Fib
        </button>
        {fibs.length > 0 && (
          <button
            onClick={() => { setFibs([]); fibPrimitiveRef.current?.clearFibs(); }}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 4,
              color: '#8a8f98',
              cursor: 'pointer',
            }}
          >
            Clear Fibs
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: fibMode ? '#e1e4e8' : (pendingSetup && isActive) ? (pendingSetup.side === 'buy' ? '#0ecb81' : '#f6465d') : '#555', alignSelf: 'center' }}>
          {fibMode
            ? (!fibFirstClick ? 'Click first fib point — ESC to cancel' : 'Click second fib point — ESC to cancel')
            : (pendingSetup && isActive)
            ? `Click to place ${pendingSetup.side === 'buy' ? 'Long' : 'Short'} setup (${pendingSetup.clicks.length}/3) — ESC to cancel`
            : 'Shift+Click: place order (or TP/SL if position open)'}
        </span>
      </div>

      <div
        ref={chartContainerRef}
        style={{ flex: 1, position: 'relative', minHeight: 300 }}
        onMouseDown={handleChartClick}
        onMouseMove={handleChartMouseMove}
        onMouseUp={handleChartMouseUp}
      />
    </div>
  );
}

import { useEffect, useRef, useCallback, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type Time, type IPriceLine, LineStyle } from 'lightweight-charts';
import { useMarketStore, type PaneId } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useChartStore, type DraftOrder } from '../../store/useChartStore.ts';
import { useTradeSetupStore } from '../../store/useTradeSetupStore.ts';
import { TradeBoxPrimitive } from './TradeBoxPrimitive.ts';
import { OrderLinePrimitive } from './OrderLinePrimitive.ts';
import { SessionPrimitive } from './SessionPrimitive.ts';
import { FibPrimitive, type FibRetracement } from './FibPrimitive.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { CandleInterval } from '../../types/market.ts';

/**
 * lightweight-charts displays timestamps via getUTCHours(), so the x-axis
 * always shows UTC. We want to show New York (ET) time instead.
 * Shift timestamps by the NY UTC offset so the chart "accidentally" displays ET.
 */
function nyOffsetSec(utcSec: number): number {
  const d = new Date(utcSec * 1000);
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d);
  const nyH = parseInt(ny.find(p => p.type === 'hour')!.value, 10) % 24;
  const nyM = parseInt(ny.find(p => p.type === 'minute')!.value, 10);
  const nySod = nyH * 3600 + nyM * 60;
  const utcSod = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60;
  let off = nySod - utcSod;
  if (off > 43200) off -= 86400;
  if (off < -43200) off += 86400;
  return off;
}

let _cachedOffset: number | null = null;
let _cachedOffsetExpiry = 0;
export function getNyOffset(utcSec: number): number {
  if (_cachedOffset !== null && utcSec < _cachedOffsetExpiry) return _cachedOffset;
  _cachedOffset = nyOffsetSec(utcSec);
  _cachedOffsetExpiry = utcSec + 3600;
  return _cachedOffset;
}

export function utcToChartTime(utcSec: number): number {
  return utcSec + getNyOffset(utcSec);
}

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
  const paneOrders = paperOrders.filter(o => o.coin === currentAsset);

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
      sessionPrimitiveRef.current = null;
      fibPrimitiveRef.current = null;
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    const seen = new Set<number>();
    const data: CandlestickData[] = [];
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
      data.push({ time: t as Time, open: o, high: h, low: l, close: cl });
    }
    data.sort((a, b) => (a.time as number) - (b.time as number));

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
  }, [mode, paperPositions, draftOrder, pendingSetup, currentAsset, fibFirstClick, isActive, engine]);

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

    if (!e.shiftKey) return;

    const mid = parseFloat(allMids[currentAsset] ?? '0');
    void mid;
    const pos = paperPositions.find(p => p.coin === currentAsset);

    let draft: DraftOrder;

    if (pos && !pos.szi.isZero()) {
      const isLong = pos.szi.gt(0);
      const entryPx = pos.entryPx.toNumber();
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
    if (sizeUsdc && parseFloat(sizeUsdc) > 0) {
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

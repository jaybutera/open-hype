import { useEffect, useRef, useCallback, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type Time, type IPriceLine, LineStyle } from 'lightweight-charts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useChartStore, type DraftOrder } from '../../store/useChartStore.ts';
import { useTradeSetupStore } from '../../store/useTradeSetupStore.ts';
import { TradeBoxPrimitive } from './TradeBoxPrimitive.ts';
import { OrderLinePrimitive } from './OrderLinePrimitive.ts';
import { SessionPrimitive } from './SessionPrimitive.ts';
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

/** Cache the offset — it only changes twice a year */
let _cachedOffset: number | null = null;
let _cachedOffsetExpiry = 0;
export function getNyOffset(utcSec: number): number {
  if (_cachedOffset !== null && utcSec < _cachedOffsetExpiry) return _cachedOffset;
  _cachedOffset = nyOffsetSec(utcSec);
  // Re-check every hour in case of DST transition
  _cachedOffsetExpiry = utcSec + 3600;
  return _cachedOffset;
}

/** Shift a UTC unix timestamp so lightweight-charts displays it as NY time */
export function utcToChartTime(utcSec: number): number {
  return utcSec + getNyOffset(utcSec);
}

const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface Props {
  engine: PaperEngine;
}

export function TradingChart({ engine }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const tradeBoxPrimitivesRef = useRef<Map<string, TradeBoxPrimitive>>(new Map());
  const orderLinePrimitivesRef = useRef<Map<string, OrderLinePrimitive>>(new Map());
  const sessionPrimitiveRef = useRef<SessionPrimitive | null>(null);
  const [sessionsOn, setSessionsOn] = useState(true);

  const candles = useMarketStore(s => s.candles);
  const currentAsset = useMarketStore(s => s.currentAsset);
  const allMids = useMarketStore(s => s.allMids);
  const interval = useMarketStore(s => s.interval);
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

  // Create chart — only once
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    // Clear any leftover children from StrictMode double-mount
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

    // Attach session killzone overlay
    const sessionPrim = new SessionPrimitive();
    series.attachPrimitive(sessionPrim);
    sessionPrimitiveRef.current = sessionPrim;

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
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    // Deduplicate by time and sort ascending
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

    // Feed candle data to session overlay for high/low calculation
    sessionPrimitiveRef.current?.setCandleData(data);
  }, [candles]);

  // Load more candles when scrolling to the left edge
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      // When the left edge of the visible range is near/past the first bar, load more
      if (range.from < 5) {
        loadMoreCandles();
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [loadMoreCandles]);

  // Draw order / position / draft price lines
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    // Remove old lines
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
          // Entry price line
          priceLinesRef.current.push(series.createPriceLine({
            price: pos.entryPx.toNumber(),
            color: isLong ? '#0ecb81' : '#f6465d',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `${isLong ? 'LONG' : 'SHORT'} ${pos.szi.abs().toString()} @ ${pos.entryPx.toFixed(1)}  ${upnlStr}`,
          }));

          // Liquidation price line
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

      // Paper orders are rendered as draggable OrderLinePrimitives (managed separately below)
    }

    if (draftOrder) {
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

    // Draw pending setup click markers
    if (pendingSetup) {
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
  }, [mode, paperPositions, draftOrder, pendingSetup, currentAsset]);

  // Mouse down: handle trade box interactions first, then setup clicks, then shift+click orders
  const handleChartClick = useCallback((e: React.MouseEvent) => {
    if (!seriesRef.current) return;

    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const price = seriesRef.current.coordinateToPrice(y);
    if (price === null || price === undefined) return;
    const priceNum = Number(price);

    // 1. Check trade box button clicks and drag starts
    for (const prim of tradeBoxPrimitivesRef.current.values()) {
      if (prim.handleMouseDown(x, y)) return;
    }

    // 1b. Check order line drag starts
    for (const prim of orderLinePrimitivesRef.current.values()) {
      if (prim.handleMouseDown(x, y)) return;
    }

    // 2. If a setup is pending, feed clicks to it (no shift required)
    const pending = useTradeSetupStore.getState().pendingSetup;
    if (pending) {
      addClick(priceNum);
      return;
    }

    // 3. Original shift+click logic
    if (!e.shiftKey) return;

    const mid = parseFloat(allMids[currentAsset] ?? '0');
    const pos = paperPositions.find(p => p.coin === currentAsset);

    let draft: DraftOrder;

    if (pos && !pos.szi.isZero()) {
      // Has position — shift+click places TP or SL
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
      // No position — use the side selected in the order panel
      const { side } = useSettingsStore.getState();
      draft = { side, type: 'limit', price: priceNum };
    }

    // If size is set in the panel, place immediately without modal
    const { sizeUsdc } = useSettingsStore.getState();
    if (sizeUsdc && parseFloat(sizeUsdc) > 0) {
      placeFromDraft(draft, sizeUsdc, priceNum);
    } else {
      setDraftOrder(draft);
      setShowConfirm(true);
    }
  }, [allMids, currentAsset, paperPositions, setDraftOrder, setShowConfirm, addClick]);

  const placeFromDraft = useCallback((draft: DraftOrder, sizeUsdc: string, priceNum: number) => {
    const isReduceOnly = draft.type === 'tp' || draft.type === 'stop';

    // For TP/SL, use the full position size so it closes entirely.
    // Using sizeUsdc / triggerPrice would under-size the close order.
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

  // Manage trade box primitives (attach/detach/update)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const primMap = tradeBoxPrimitivesRef.current;
    const activeIds = new Set(activeSetups.map(s => s.id));

    // Remove primitives for setups that no longer exist
    for (const [id, prim] of primMap) {
      if (!activeIds.has(id)) {
        series.detachPrimitive(prim);
        primMap.delete(id);
      }
    }

    // Add or update primitives
    for (const setup of activeSetups) {
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
  }, [activeSetups, removeSetup, updateSetup]);

  // Callback: when an order line drag finishes, cancel old order and re-place at new price
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

  // Manage order line primitives (attach/detach/update)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const primMap = orderLinePrimitivesRef.current;
    const currentOrderIds = new Set(
      paperOrders.filter(o => o.coin === currentAsset).map(o => o.id)
    );

    // Remove primitives for orders that no longer exist or are wrong asset
    for (const [id, prim] of primMap) {
      if (!currentOrderIds.has(id)) {
        series.detachPrimitive(prim);
        primMap.delete(id);
      }
    }

    // Add or update
    for (const ord of paperOrders) {
      if (ord.coin !== currentAsset) continue;
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
  }, [paperOrders, currentAsset, handleOrderDragDone]);

  const handleChartMouseMove = useCallback((e: React.MouseEvent) => {
    if (!seriesRef.current) return;

    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const price = seriesRef.current.coordinateToPrice(y);
    if (price === null || price === undefined) return;
    const priceNum = Number(price);

    // Check trade box drags first
    for (const prim of tradeBoxPrimitivesRef.current.values()) {
      if (prim.handleMouseMove(priceNum)) return;
    }

    // Check order line drags
    for (const prim of orderLinePrimitivesRef.current.values()) {
      if (prim.handleMouseMove(priceNum)) return;
    }

    // Original draft order drag
    const { draftOrder: draft, isDragging } = useChartStore.getState();
    if (!isDragging || !draft) return;
    setDraftOrder({ ...draft, price: priceNum });
  }, [setDraftOrder]);

  const handleChartMouseUp = useCallback(() => {
    // Release trade box drags
    for (const prim of tradeBoxPrimitivesRef.current.values()) {
      if (prim.handleMouseUp()) return;
    }

    // Release order line drags (fires cancel+re-place via callback)
    for (const prim of orderLinePrimitivesRef.current.values()) {
      if (prim.handleMouseUp()) return;
    }

    // Original draft order release
    const draft = useChartStore.getState().draftOrder;
    if (draft) {
      setDragging(false);
      setShowConfirm(true);
    }
  }, [setDragging, setShowConfirm]);

  // Toggle session overlay
  useEffect(() => {
    sessionPrimitiveRef.current?.setEnabled(sessionsOn);
  }, [sessionsOn]);

  // ESC cancels pending trade setup
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearPending();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearPending]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', background: '#0d1117' }}>
        {INTERVALS.map(iv => (
          <button
            key={iv}
            onClick={() => { setInterval(iv); loadCandles(); }}
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
        <span style={{ marginLeft: 'auto', fontSize: 11, color: pendingSetup ? (pendingSetup.side === 'buy' ? '#0ecb81' : '#f6465d') : '#555', alignSelf: 'center' }}>
          {pendingSetup
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

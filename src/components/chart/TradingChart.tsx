import { useEffect, useRef, useCallback } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type Time, type IPriceLine, type LineWidth, LineStyle } from 'lightweight-charts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useChartStore, type DraftOrder } from '../../store/useChartStore.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { CandleInterval } from '../../types/market.ts';

const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface Props {
  engine: PaperEngine;
}

export function TradingChart({ engine }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const candles = useMarketStore(s => s.candles);
  const currentAsset = useMarketStore(s => s.currentAsset);
  const allMids = useMarketStore(s => s.allMids);
  const interval = useMarketStore(s => s.interval);
  const setInterval = useMarketStore(s => s.setInterval);
  const loadCandles = useMarketStore(s => s.loadCandles);
  const mode = useSettingsStore(s => s.mode);
  const paperPositions = useAccountStore(s => s.paperPositions);
  const paperOrders = useAccountStore(s => s.paperOrders);
  const draftOrder = useChartStore(s => s.draftOrder);
  const setDraftOrder = useChartStore(s => s.setDraftOrder);
  const setShowConfirm = useChartStore(s => s.setShowConfirm);
  const setDragging = useChartStore(s => s.setDragging);

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
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    // Deduplicate by time and sort ascending
    const seen = new Set<number>();
    const data: CandlestickData[] = [];
    for (const c of candles) {
      const t = Math.floor(c.t / 1000);
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
  }, [candles]);

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

      for (const ord of paperOrders) {
        if (ord.coin !== currentAsset) continue;
        // Style differently for TP, SL, and regular limit orders
        let color: string;
        let label: string;
        let style: number;
        let width: LineWidth;

        if (ord.tpsl === 'tp') {
          color = '#0ecb81';
          label = `TP`;
          style = LineStyle.Dashed;
          width = 2;
        } else if (ord.tpsl === 'sl') {
          color = '#f6465d';
          label = `SL`;
          style = LineStyle.Dashed;
          width = 2;
        } else {
          const isBuy = ord.side === 'buy';
          color = isBuy ? '#3861fb' : '#e67e22';
          label = `LIMIT ${ord.side.toUpperCase()}`;
          style = LineStyle.Dotted;
          width = 1;
        }

        try {
          priceLinesRef.current.push(series.createPriceLine({
            price: (ord.triggerPx ?? ord.price).toNumber(),
            color,
            lineWidth: width,
            lineStyle: style,
            axisLabelVisible: true,
            title: `${label} ${ord.size.toString()} @ ${(ord.triggerPx ?? ord.price).toFixed(1)}`,
          }));
        } catch {}
      }
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
  }, [mode, paperPositions, paperOrders, draftOrder, currentAsset]);

  // Shift+Click: place order from chart.
  // If position exists: above entry = TP, below entry = SL (for longs; reversed for shorts).
  // If no position: below mid = limit buy, above mid = limit sell.
  // If sizeUsdc is already set in the panel, place immediately (no modal).
  const handleChartClick = useCallback((e: React.MouseEvent) => {
    if (!e.shiftKey || !seriesRef.current) return;

    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const y = e.clientY - rect.top;
    const price = seriesRef.current.coordinateToPrice(y);
    if (price === null || price === undefined) return;

    const mid = parseFloat(allMids[currentAsset] ?? '0');
    const priceNum = Number(price);
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
  }, [allMids, currentAsset, paperPositions, setDraftOrder, setShowConfirm]);

  const placeFromDraft = useCallback((draft: DraftOrder, sizeUsdc: string, priceNum: number) => {
    const assetSize = (parseFloat(sizeUsdc) / priceNum).toString();
    const isReduceOnly = draft.type === 'tp' || draft.type === 'stop';

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

  const handleChartMouseMove = useCallback((e: React.MouseEvent) => {
    const { draftOrder: draft, isDragging } = useChartStore.getState();
    if (!isDragging || !draft || !seriesRef.current) return;

    const rect = chartContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const price = seriesRef.current.coordinateToPrice(y);
    if (price !== null && price !== undefined) {
      setDraftOrder({ ...draft, price: Number(price) });
    }
  }, [setDraftOrder]);

  const handleChartMouseUp = useCallback(() => {
    const draft = useChartStore.getState().draftOrder;
    if (draft) {
      setDragging(false);
      setShowConfirm(true);
    }
  }, [setDragging, setShowConfirm]);

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
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#555', alignSelf: 'center' }}>
          Shift+Click: place order (or TP/SL if position open)
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

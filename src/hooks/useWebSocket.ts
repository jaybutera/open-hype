import { useEffect, useRef, useMemo } from 'react';
import { ws } from '../services/ws/connection.ts';
import { useMarketStore } from '../store/useMarketStore.ts';
import type { PaperEngine } from '../engine/paper/PaperEngine.ts';
import type { CandleData, CandleInterval } from '../types/market.ts';

export function useWebSocket(engine: PaperEngine): void {
  const panes = useMarketStore(s => s.panes);
  const appendCandle = useMarketStore(s => s.appendCandle);
  const connectedRef = useRef(false);

  // Connect once
  useEffect(() => {
    if (!connectedRef.current) {
      ws.connect();
      connectedRef.current = true;
    }
    return () => {
      ws.disconnect();
      connectedRef.current = false;
    };
  }, []);

  // Subscribe to perps allMids
  useEffect(() => {
    return ws.subscribe('allMids', {}, (data) => {
      const msg = data as { mids: Record<string, string> };
      if (!msg.mids) return;
      useMarketStore.getState().batchUpdateMids(msg.mids);

      // Forward price updates for all coins with positions or open orders
      const positions = engine.getPositions();
      const orders = engine.getOpenOrders();
      const activeCoins = new Set<string>();
      for (const p of positions) activeCoins.add(p.coin);
      for (const o of orders) activeCoins.add(o.coin);
      // Include every pane's asset so PnL stays live
      const ps = useMarketStore.getState().panes;
      for (const id of ['primary', 'secondary'] as const) {
        const pane = ps[id];
        if (pane) activeCoins.add(pane.asset);
      }

      for (const coin of activeCoins) {
        const mid = msg.mids[coin];
        if (mid) engine.onPriceUpdate(coin, mid);
      }
    });
  }, [engine]);

  // Subscribe to xyz allMids
  useEffect(() => {
    return ws.subscribe('allMids', { dex: 'xyz' }, (data) => {
      const msg = data as { mids: Record<string, string> };
      if (!msg.mids) return;
      useMarketStore.getState().batchUpdateMids(msg.mids);

      const positions = engine.getPositions();
      const orders = engine.getOpenOrders();
      const activeCoins = new Set<string>();
      for (const p of positions) activeCoins.add(p.coin);
      for (const o of orders) activeCoins.add(o.coin);
      const ps = useMarketStore.getState().panes;
      for (const id of ['primary', 'secondary'] as const) {
        const pane = ps[id];
        if (pane) activeCoins.add(pane.asset);
      }

      for (const coin of activeCoins) {
        const mid = msg.mids[coin];
        if (mid) engine.onPriceUpdate(coin, mid);
      }
    });
  }, [engine]);

  // Subscribe to candles for the union of all panes' (asset, interval) pairs.
  // Memoize the key list so we only re-subscribe when the set actually changes,
  // not on every unrelated pane state update (e.g. candle arrays).
  const candleKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const id of ['primary', 'secondary'] as const) {
      const pane = panes[id];
      if (pane) keys.add(`${pane.asset}|${pane.interval}`);
    }
    return Array.from(keys);
  }, [panes.primary?.asset, panes.primary?.interval, panes.secondary?.asset, panes.secondary?.interval]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    for (const key of candleKeys) {
      const [coin, interval] = key.split('|') as [string, CandleInterval];
      const unsub = ws.subscribe('candle', { coin, interval }, (data) => {
        const candle = data as CandleData;
        if (!candle || candle.t === undefined || candle.s !== coin) return;
        appendCandle(candle, interval);
        // Forward candle high/low to paper engine for TP/SL trigger checking.
        engine.onCandleUpdate(coin, candle.h, candle.l);
      });
      unsubs.push(unsub);
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [candleKeys.join(','), appendCandle, engine]);
}

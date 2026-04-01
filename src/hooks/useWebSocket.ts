import { useEffect, useRef } from 'react';
import { ws } from '../services/ws/connection.ts';
import { useMarketStore } from '../store/useMarketStore.ts';
import type { PaperEngine } from '../engine/paper/PaperEngine.ts';
import type { CandleData } from '../types/market.ts';

export function useWebSocket(engine: PaperEngine): void {
  const currentAsset = useMarketStore(s => s.currentAsset);
  const interval = useMarketStore(s => s.interval);
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
      // so TP/SL triggers even when viewing a different coin
      const positions = engine.getPositions();
      const orders = engine.getOpenOrders();
      const activeCoins = new Set<string>();
      for (const p of positions) activeCoins.add(p.coin);
      for (const o of orders) activeCoins.add(o.coin);
      // Always include the currently viewed coin for PnL updates
      activeCoins.add(useMarketStore.getState().currentAsset);

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
      activeCoins.add(useMarketStore.getState().currentAsset);

      for (const coin of activeCoins) {
        const mid = msg.mids[coin];
        if (mid) engine.onPriceUpdate(coin, mid);
      }
    });
  }, [engine]);

  // Subscribe to candles for current asset
  useEffect(() => {
    const coin = currentAsset;
    return ws.subscribe('candle', { coin, interval }, (data) => {
      const candle = data as CandleData;
      if (candle && candle.t !== undefined && candle.s === coin) {
        appendCandle(candle);
        // Forward candle high/low to paper engine for TP/SL trigger checking.
        // Mid price alone can miss wicks that cross trigger levels.
        engine.onCandleUpdate(coin, candle.h, candle.l);
      }
    });
  }, [currentAsset, interval, appendCandle]);
}

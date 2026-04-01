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

      const currentCoin = useMarketStore.getState().currentAsset;
      const mid = msg.mids[currentCoin];
      if (mid) engine.onPriceUpdate(currentCoin, mid);
    });
  }, [engine]);

  // Subscribe to xyz allMids
  useEffect(() => {
    return ws.subscribe('allMids', { dex: 'xyz' }, (data) => {
      const msg = data as { mids: Record<string, string> };
      if (!msg.mids) return;
      useMarketStore.getState().batchUpdateMids(msg.mids);

      const currentCoin = useMarketStore.getState().currentAsset;
      const mid = msg.mids[currentCoin];
      if (mid) engine.onPriceUpdate(currentCoin, mid);
    });
  }, [engine]);

  // Subscribe to candles for current asset
  useEffect(() => {
    const coin = currentAsset;
    return ws.subscribe('candle', { coin, interval }, (data) => {
      const candle = data as CandleData;
      if (candle && candle.t !== undefined && candle.s === coin) {
        appendCandle(candle);
      }
    });
  }, [currentAsset, interval, appendCandle]);
}

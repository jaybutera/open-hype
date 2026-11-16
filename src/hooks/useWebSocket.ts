import { useEffect, useRef, useMemo } from 'react';
import { ws } from '../services/ws/connection.ts';
import { useMarketStore } from '../store/useMarketStore.ts';
import { useReplayStore } from '../store/useReplayStore.ts';
import { useAccountStore } from '../store/useAccountStore.ts';
import type { PaperEngine } from '../engine/paper/PaperEngine.ts';
import type { CandleData, CandleInterval } from '../types/market.ts';

export function useWebSocket(engine: PaperEngine): void {
  const panes = useMarketStore(s => s.panes);
  const appendCandle = useMarketStore(s => s.appendCandle);
  // While replay is active the local recording drives mids/candles/engine —
  // skip all live subscriptions so real-time data can't bleed into the replay.
  const replayActive = useReplayStore(s => s.active);
  const connectedRef = useRef(false);
  // Coins with a resting paper limit, for the dwell fill rule's trade feed.
  const limitCoins = useAccountStore(s =>
    Array.from(new Set(s.paperOrders.filter(o => o.type === 'limit').map(o => o.coin))).sort().join(','),
  );

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
    if (replayActive) return;
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
  }, [engine, replayActive]);

  // Subscribe to xyz allMids
  useEffect(() => {
    if (replayActive) return;
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
  }, [engine, replayActive]);

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
    if (replayActive) return;
    const unsubs: Array<() => void> = [];
    for (const key of candleKeys) {
      const [coin, interval] = key.split('|') as [string, CandleInterval];
      if (interval === '30s') {
        // Hyperliquid has no 30s candle feed: fold trades into the forming bar.
        // The subscribe snapshot repeats trades the recorder already counted; skip them and repeats.
        const since = Date.now();
        const seen = new Set<number>();
        unsubs.push(ws.subscribe('trades', { coin }, (data) => {
          if (!Array.isArray(data)) return;
          for (const t of data as Array<{ coin: string; px: string; sz: string; time: number; tid: number }>) {
            if (t.coin !== coin || t.time < since || seen.has(t.tid)) continue;
            seen.add(t.tid);
            if (seen.size > 5000) seen.clear();
            const pane = Object.values(useMarketStore.getState().panes)
              .find(p => p && p.asset === coin && p.interval === '30s');
            const candle = foldTrade(pane?.candles[pane.candles.length - 1], t);
            if (!candle) continue;
            appendCandle(candle, interval);
            engine.onCandleUpdate(coin, candle.h, candle.l, candle.t);
          }
        }));
        continue;
      }
      const unsub = ws.subscribe('candle', { coin, interval }, (data) => {
        const candle = data as CandleData;
        if (!candle || candle.t === undefined || candle.s !== coin || candle.i !== interval) return;
        appendCandle(candle, interval);
        // Forward candle high/low to paper engine for TP/SL trigger checking.
        engine.onCandleUpdate(coin, candle.h, candle.l, candle.t);
      });
      unsubs.push(unsub);
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [candleKeys.join(','), appendCandle, engine, replayActive]);

  // Last trade price per coin drives the dwell fill rule: a paper limit fills
  // once trades have sat at or through it for 2s, without waiting for the mid.
  useEffect(() => {
    if (replayActive || !limitCoins) return;
    const unsubs = limitCoins.split(',').map(coin =>
      ws.subscribe('trades', { coin }, (data) => {
        const trades = data as Array<{ coin: string; px: string }>;
        if (!Array.isArray(trades)) return;
        let last: string | undefined;
        for (const t of trades) if (t.coin === coin) last = t.px;
        if (last) engine.onTouchPrice(coin, last, last);
      }),
    );
    return () => { for (const u of unsubs) u(); };
  }, [limitCoins, engine, replayActive]);
}

/** Merge one trade into the 30s bar it falls in; undefined for a trade older than the last bar. */
export function foldTrade(
  last: CandleData | undefined,
  t: { coin: string; px: string; sz: string; time: number },
): CandleData | undefined {
  const bucket = Math.floor(t.time / 30_000) * 30_000;
  if (last && bucket < last.t) return undefined;
  if (!last || bucket > last.t) {
    return { t: bucket, T: bucket + 29_999, s: t.coin, i: '30s', o: t.px, h: t.px, l: t.px, c: t.px, v: t.sz, n: 1 };
  }
  const px = parseFloat(t.px);
  return {
    ...last,
    h: px > parseFloat(last.h) ? t.px : last.h,
    l: px < parseFloat(last.l) ? t.px : last.l,
    c: t.px,
    v: String(+(parseFloat(last.v) + parseFloat(t.sz)).toPrecision(12)),
    n: last.n + 1,
  };
}

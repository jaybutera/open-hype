import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandleData } from '../../types/market.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 2, 16); // 2026-03-16T00:00Z
const LAST = T0 + 119 * MIN; // two hours of synthetic 1m data

function synth(t: number): CandleData {
  const i = (t - T0) / MIN;
  const o = 100 + i;
  return {
    t, T: t + MIN - 1, s: 'BTC', i: '1m',
    o: String(o), h: String(o + 1), l: String(o - 1), c: String(o + 0.5),
    v: '1', n: 1,
  };
}

// GAP behaves like a closed market between minutes 60 and 180 (exclusive).
const GAP_LAST = T0 + 240 * MIN;
const inGap = (t: number) => t >= T0 + 60 * MIN && t < T0 + 180 * MIN;

vi.mock('../../services/replay/api.ts', () => ({
  fetchReplayAssets: vi.fn(async () => [
    { coin: 'BTC', firstTs: T0, lastTs: LAST },
    { coin: 'GAP', firstTs: T0, lastTs: GAP_LAST },
  ]),
  fetchReplayCandles: vi.fn(async (coin: string, start: number, end: number) => {
    const last = coin === 'GAP' ? GAP_LAST : LAST;
    const out: CandleData[] = [];
    for (let t = Math.max(start, T0); t < Math.min(end, last + MIN); t += MIN) {
      if (coin === 'GAP' && inGap(t)) continue;
      out.push({ ...synth(t), s: coin });
    }
    return out;
  }),
}));

import { useReplayStore } from '../useReplayStore.ts';
import { useMarketStore } from '../useMarketStore.ts';
import { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import { appNow } from '../../services/replay/clock.ts';

describe('useReplayStore', () => {
  let engine: PaperEngine;

  beforeEach(async () => {
    engine = new PaperEngine({ initialBalance: '10000', now: appNow });
    const replay = useReplayStore.getState();
    if (replay.active) replay.exitReplay();
    replay.registerEngine(engine);
    useMarketStore.setState({
      panes: {
        primary: { asset: 'BTC', assetIndex: 0, interval: '5m', candles: [], loading: false },
        secondary: undefined,
      },
      activePaneId: 'primary',
    });
    await replay.loadAssets();
  });

  it('enterReplay loads aggregated history up to the cursor', async () => {
    await useReplayStore.getState().enterReplay(T0 + 60 * MIN);
    const s = useReplayStore.getState();
    expect(s.active).toBe(true);
    expect(s.cursor).toBe(T0 + 60 * MIN);

    const candles = useMarketStore.getState().panes.primary!.candles;
    expect(candles).toHaveLength(12); // 60 minutes / 5m
    const last = candles[candles.length - 1];
    expect(last.t).toBe(T0 + 55 * MIN);
    expect(last.i).toBe('5m');
    expect(last.c).toBe(String(100 + 59 + 0.5));
    // mid seeded from last revealed close
    expect(useMarketStore.getState().allMids['BTC']).toBe(String(100 + 59 + 0.5));
  });

  it('stepForward reveals exactly one active-interval candle', async () => {
    await useReplayStore.getState().enterReplay(T0 + 60 * MIN);
    await useReplayStore.getState().stepForward();

    const s = useReplayStore.getState();
    expect(s.cursor).toBe(T0 + 65 * MIN);
    const candles = useMarketStore.getState().panes.primary!.candles;
    expect(candles).toHaveLength(13);
    const last = candles[candles.length - 1];
    expect(last.t).toBe(T0 + 60 * MIN);
    expect(last.o).toBe(String(100 + 60));
    expect(last.h).toBe(String(100 + 64 + 1));
    expect(last.c).toBe(String(100 + 64 + 0.5));
  });

  it('completes a partial candle when cursor is mid-bucket', async () => {
    await useReplayStore.getState().enterReplay(T0 + 62 * MIN); // 2min into a 5m bucket
    await useReplayStore.getState().stepForward();
    expect(useReplayStore.getState().cursor).toBe(T0 + 65 * MIN);
  });

  it('fills paper orders with historical timestamps', async () => {
    await useReplayStore.getState().enterReplay(T0 + 60 * MIN);
    // Buy limit above market: fills on the next revealed close.
    const res = engine.placeOrder({
      coin: 'BTC',
      side: 'buy',
      price: '500',
      size: '1',
      reduceOnly: false,
      orderType: { limit: { tif: 'Gtc' } },
    });
    expect(res.success).toBe(true);
    await useReplayStore.getState().stepForward();

    const fills = engine.getFills();
    expect(fills).toHaveLength(1);
    // First minute of the step is t = T0+60min; clock is its close time.
    expect(fills[0].timestamp).toBe(T0 + 61 * MIN - 1);
    expect(engine.getPositions()[0].coin).toBe('BTC');
  });

  it('stops at the end of the recording', async () => {
    await useReplayStore.getState().enterReplay(LAST - 4 * MIN); // t=115min, aligned 5m
    await useReplayStore.getState().stepForward(); // reveals 115..119
    expect(useReplayStore.getState().cursor).toBe(LAST + MIN);
    await useReplayStore.getState().stepForward();
    expect(useReplayStore.getState().atEnd).toBe(true);
  });

  it('skips over data gaps (closed market) when stepping', async () => {
    useMarketStore.setState({
      panes: {
        primary: { asset: 'GAP', assetIndex: 0, interval: '5m', candles: [], loading: false },
        secondary: undefined,
      },
      activePaneId: 'primary',
    });
    await useReplayStore.getState().enterReplay(T0 + 60 * MIN); // gap starts here
    await useReplayStore.getState().stepForward();
    // Next recorded candle is at minute 180; step completes that 5m bucket.
    expect(useReplayStore.getState().cursor).toBe(T0 + 185 * MIN);
    const candles = useMarketStore.getState().panes.primary!.candles;
    expect(candles[candles.length - 1].t).toBe(T0 + 180 * MIN);
  });

  it('exitReplay restores live mode', async () => {
    await useReplayStore.getState().enterReplay(T0 + 60 * MIN);
    // Stub live reload paths so exit doesn't hit the network.
    useMarketStore.setState({
      loadCandles: async () => {},
      loadAllMids: async () => {},
    } as never);
    useReplayStore.getState().exitReplay();
    expect(useReplayStore.getState().active).toBe(false);
    // Virtual clock uninstalled
    expect(Math.abs(appNow() - Date.now())).toBeLessThan(1000);
  });
});

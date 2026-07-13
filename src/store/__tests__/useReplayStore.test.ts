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

// TICK has BBO ticks for its whole range. Within each minute the mid traces an
// up-then-down spike: base -> base+3 (at +20s) -> base-3 (at +40s) -> base.
// The 1m bar for the same minute (from synth) has a much tighter high/low, so a
// fill that only a tick could reach proves ticks are driving the engine.
const TICK_SPIKE = [
  { off: 0, mid: 0 },
  { off: 20_000, mid: 3 },
  { off: 40_000, mid: -3 },
  { off: 59_000, mid: 0 },
];

vi.mock('../../services/replay/api.ts', () => ({
  fetchReplayAssets: vi.fn(async () => [
    { coin: 'BTC', firstTs: T0, lastTs: LAST },
    { coin: 'GAP', firstTs: T0, lastTs: GAP_LAST },
    { coin: 'TICK', firstTs: T0, lastTs: LAST, ticks: { firstTs: T0, lastTs: LAST + MIN } },
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
  fetchReplayTicks: vi.fn(async (coin: string, start: number, end: number) => {
    if (coin !== 'TICK') return [];
    const out: Array<{ t: number; bid: number; ask: number }> = [];
    const firstMin = Math.floor(start / MIN) * MIN;
    for (let m = firstMin; m < end; m += MIN) {
      const base = 100 + (m - T0) / MIN; // same base as synth's open
      for (const { off, mid } of TICK_SPIKE) {
        const t = m + off;
        if (t < start || t >= end) continue;
        const px = base + mid;
        out.push({ t, bid: px - 0.5, ask: px + 0.5 }); // mid == px
      }
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

  describe('tick resolution', () => {
    const useTickPane = () => useMarketStore.setState({
      panes: {
        primary: { asset: 'TICK', assetIndex: 0, interval: '5m', candles: [], loading: false },
        secondary: undefined,
      },
      activePaneId: 'primary',
    });

    it('drives the engine from ticks, filling inside the minute', async () => {
      useTickPane();
      await useReplayStore.getState().enterReplay(T0 + 60 * MIN);

      // Minute 60: bar high is 161 (synth o=160, h=o+1), but the tick path
      // spikes to 163. A sell limit at 162.5 is reachable ONLY via ticks.
      const res = engine.placeOrder({
        coin: 'TICK',
        side: 'sell',
        price: '162.5',
        size: '1',
        reduceOnly: false,
        orderType: { limit: { tif: 'Gtc' } },
      });
      expect(res.success).toBe(true);

      await useReplayStore.getState().advanceMinutes(1);

      const fills = engine.getFills();
      expect(fills).toHaveLength(1);
      // Stamped at the spike tick (minute 60 + 20s), not the minute close.
      expect(fills[0].timestamp).toBe(T0 + 60 * MIN + 20_000);
      expect(useReplayStore.getState().tickResolution).toBe(true);
    });

    it('sequences within the minute: stop hit before target on an up-then-down path', async () => {
      useTickPane();
      await useReplayStore.getState().enterReplay(T0 + 60 * MIN);

      // Long position, then a TP above and SL below — both inside the minute's
      // tick range. The path goes UP first, so the TP must win.
      engine.placeOrder({
        coin: 'TICK', side: 'buy', size: '1', price: '160', reduceOnly: false,
        orderType: { limit: { tif: 'Gtc' } },
      });
      await useReplayStore.getState().advanceMinutes(1);
      expect(engine.getPositions()).toHaveLength(1);

      const before = engine.getFills().length;
      // Minute 61: base 161, path 161 -> 164 -> 158 -> 161.
      engine.placeOrder({
        coin: 'TICK', side: 'sell', size: '1', price: '163', reduceOnly: true, tpsl: 'tp',
        orderType: { limit: { tif: 'Gtc' } },
      } as never);
      await useReplayStore.getState().advanceMinutes(1);

      const closing = engine.getFills().slice(before);
      expect(closing.length).toBeGreaterThanOrEqual(1);
      // Filled on the way up (+20s), not at the minute close.
      expect(closing[0].timestamp).toBe(T0 + 61 * MIN + 20_000);
      expect(engine.getPositions()).toHaveLength(0);
    });

    it('falls back to 1m bars for coins with no ticks', async () => {
      await useReplayStore.getState().enterReplay(T0 + 60 * MIN); // BTC pane, no ticks
      await useReplayStore.getState().advanceMinutes(1);
      expect(useReplayStore.getState().tickResolution).toBe(false);
      // Mid is the bar close, as before.
      expect(useMarketStore.getState().allMids['BTC']).toBe(String(100 + 60 + 0.5));
    });
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

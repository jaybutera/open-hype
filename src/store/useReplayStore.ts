import { create } from 'zustand';
import type { CandleData, CandleInterval } from '../types/market.ts';
import type { PaperEngine } from '../engine/paper/PaperEngine.ts';
import { fetchReplayAssets, fetchReplayCandles, type ReplayAssetInfo } from '../services/replay/api.ts';
import { aggregate1m, bucketStart, intervalToMs, mergeIntoInterval } from '../services/replay/aggregate.ts';
import { setReplayCandleSource } from '../services/replay/source.ts';
import { setReplayClock } from '../services/replay/clock.ts';
import { useMarketStore, type PaneId } from './useMarketStore.ts';
import { useSettingsStore } from './useSettingsStore.ts';

const MINUTE = 60_000;
/** Fetch granularity when extending a coin buffer (2 weeks of 1m). */
const CHUNK_MS = 14 * 86_400_000;
/** History depth for initial chart loads, in interval candles. */
const HISTORY_CANDLES = 300;
/** Playback speeds, in 1m candles per second. */
export const REPLAY_SPEEDS = [1, 2, 5, 10, 30, 60];

interface CoinBuffer {
  /** Sorted 1m candles covering [from, to). Gaps inside are real data gaps. */
  candles: CandleData[];
  from: number;
  to: number;
}

const buffers = new Map<string, CoinBuffer>();
let playTimer: ReturnType<typeof setInterval> | null = null;
let advancing = false; // reentrancy guard for async advance
let stepping = false; // reentrancy guard for stepForward
let carry = 0; // fractional candles owed by the play timer

/** First index in sorted candles with t >= target. */
function lowerBound(candles: CandleData[], target: number): number {
  let lo = 0, hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Fetch [from, to) in chunks (server caps rows per response). */
async function fetchRange(coin: string, from: number, to: number): Promise<CandleData[]> {
  const out: CandleData[] = [];
  for (let cur = from; cur < to; cur += CHUNK_MS) {
    const chunk = await fetchReplayCandles(coin, cur, Math.min(cur + CHUNK_MS, to));
    out.push(...chunk);
  }
  return out;
}

interface ReplayStore {
  active: boolean;
  showSetup: boolean;
  assets: ReplayAssetInfo[];
  assetsError: string | null;
  /** Virtual clock (ms UTC): 1m candles with t < cursor are revealed. */
  cursor: number;
  playing: boolean;
  /** 1m candles per second while playing. */
  speed: number;
  buffering: boolean;
  atEnd: boolean;

  registerEngine: (engine: PaperEngine) => void;
  loadAssets: () => Promise<void>;
  setShowSetup: (v: boolean) => void;
  enterReplay: (startTs: number) => Promise<void>;
  exitReplay: () => void;
  /** Advance until the active pane's current interval candle completes. */
  stepForward: () => Promise<void>;
  togglePlay: () => void;
  setSpeed: (n: number) => void;
}

let engine: PaperEngine | null = null;

export const useReplayStore = create<ReplayStore>((set, get) => {

  function coverage(coin: string): ReplayAssetInfo | undefined {
    return get().assets.find(a => a.coin === coin);
  }

  /** Extend a coin's buffer to cover [from, to), clamped to recorded range. */
  async function ensureRange(coin: string, from: number, to: number): Promise<void> {
    const cov = coverage(coin);
    if (!cov) return;
    from = Math.max(from, cov.firstTs);
    to = Math.min(to, cov.lastTs + MINUTE);
    if (from >= to) return;

    let buf = buffers.get(coin);
    if (!buf) {
      const candles = await fetchRange(coin, from, to);
      buffers.set(coin, { candles, from, to });
      return;
    }
    if (from < buf.from) {
      const older = await fetchRange(coin, from, buf.from);
      buf = buffers.get(coin)!; // refetch — may have changed while awaiting
      if (from < buf.from) {
        buf.candles = [...older.filter(c => c.t < buf!.from), ...buf.candles];
        buf.from = from;
      }
    }
    if (to > buf.to) {
      const newer = await fetchRange(coin, buf.to, to);
      buf = buffers.get(coin)!;
      if (to > buf.to) {
        buf.candles = [...buf.candles, ...newer.filter(c => c.t >= buf!.to)];
        buf.to = to;
      }
    }
  }

  /** 1m candles with from <= t < to (buffer must already cover the range). */
  function slice(coin: string, from: number, to: number): CandleData[] {
    const buf = buffers.get(coin);
    if (!buf) return [];
    return buf.candles.slice(lowerBound(buf.candles, from), lowerBound(buf.candles, to));
  }

  /** Open time of the first recorded candle with t >= fromMs, or null. */
  async function findNextCandleTime(coin: string, fromMs: number): Promise<number | null> {
    const cov = coverage(coin);
    if (!cov || fromMs > cov.lastTs) return null;
    let searchFrom = Math.max(fromMs, cov.firstTs);
    for (;;) {
      await ensureRange(coin, searchFrom, searchFrom + CHUNK_MS);
      const buf = buffers.get(coin);
      if (!buf) return null;
      const idx = lowerBound(buf.candles, fromMs);
      if (idx < buf.candles.length) return buf.candles[idx].t;
      if (buf.to > cov.lastTs) return null; // searched to end of recording
      searchFrom = buf.to;
    }
  }

  /** Pane assets + coins the engine has exposure on, limited to recorded coins. */
  function relevantCoins(): string[] {
    const coins = new Set<string>();
    const panes = useMarketStore.getState().panes;
    for (const id of ['primary', 'secondary'] as PaneId[]) {
      const pane = panes[id];
      if (pane) coins.add(pane.asset);
    }
    if (engine) {
      for (const p of engine.getPositions()) coins.add(p.coin);
      for (const o of engine.getOpenOrders()) coins.add(o.coin);
    }
    return Array.from(coins).filter(c => coverage(c) !== undefined);
  }

  /**
   * Reveal the next recorded minute across all relevant coins: bump the
   * clock, update mids, feed the paper engine, and merge the 1m candles
   * into each pane's interval series. Returns false at end of data.
   */
  async function advanceOneMinute(): Promise<boolean> {
    const coins = relevantCoins();
    const { cursor } = get();
    let nextT: number | null = null;
    for (const coin of coins) {
      const t = await findNextCandleTime(coin, cursor);
      if (t !== null && (nextT === null || t < nextT)) nextT = t;
    }
    if (nextT === null) return false;

    const minuteCandles = new Map<string, CandleData>();
    for (const coin of coins) {
      const c = slice(coin, nextT, nextT + MINUTE)[0];
      if (c) minuteCandles.set(coin, c);
    }

    // Clock first, so fills stamped during matching carry the candle's close time.
    set({ cursor: nextT + MINUTE });

    const market = useMarketStore.getState();
    const mids: Record<string, string> = {};
    for (const [coin, c] of minuteCandles) mids[coin] = c.c;
    market.batchUpdateMids(mids);

    // Merge into each pane's interval series (per unique asset+interval pair).
    const seen = new Set<string>();
    for (const id of ['primary', 'secondary'] as PaneId[]) {
      const pane = market.panes[id];
      if (!pane) continue;
      const c = minuteCandles.get(pane.asset);
      if (!c) continue;
      const key = `${pane.asset}|${pane.interval}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const last = pane.candles[pane.candles.length - 1];
      market.appendCandle(mergeIntoInterval(last, c, pane.interval), pane.interval);
    }

    if (engine) {
      for (const [coin, c] of minuteCandles) {
        engine.onCandleUpdate(coin, c.h, c.l, c.t);
        engine.onPriceUpdate(coin, c.c);
      }
    }
    return true;
  }

  async function advance(count: number): Promise<void> {
    if (advancing) return;
    advancing = true;
    set({ buffering: true });
    try {
      for (let i = 0; i < count; i++) {
        if (!get().active) break;
        const ok = await advanceOneMinute();
        if (!ok) {
          set({ atEnd: true });
          stopTimer();
          set({ playing: false });
          break;
        }
      }
    } catch (e) {
      console.error('replay advance failed:', e);
      stopTimer();
      set({ playing: false });
    } finally {
      advancing = false;
      set({ buffering: false });
    }
  }

  function stopTimer(): void {
    if (playTimer !== null) {
      clearInterval(playTimer);
      playTimer = null;
    }
    carry = 0;
  }

  function startTimer(): void {
    stopTimer();
    playTimer = setInterval(() => {
      if (advancing) return;
      carry += get().speed * 0.1; // tick every 100ms
      const whole = Math.floor(carry);
      if (whole >= 1) {
        carry -= whole;
        void advance(whole);
      }
    }, 100);
  }

  const candleSource = {
    async loadInitial(coin: string, interval: CandleInterval): Promise<CandleData[]> {
      const { cursor } = get();
      const ivMs = intervalToMs(interval);
      const start = bucketStart(cursor - 1, ivMs) - HISTORY_CANDLES * ivMs;
      await ensureRange(coin, start, cursor);
      return aggregate1m(slice(coin, start, cursor), interval);
    },
    async loadMore(coin: string, interval: CandleInterval, beforeT: number): Promise<CandleData[]> {
      const ivMs = intervalToMs(interval);
      const start = beforeT - HISTORY_CANDLES * ivMs;
      await ensureRange(coin, start, beforeT);
      return aggregate1m(slice(coin, start, beforeT), interval);
    },
  };

  return {
    active: false,
    showSetup: false,
    assets: [],
    assetsError: null,
    cursor: 0,
    playing: false,
    speed: 10,
    buffering: false,
    atEnd: false,

    registerEngine: (e) => { engine = e; },

    loadAssets: async () => {
      try {
        const assets = await fetchReplayAssets();
        set({ assets, assetsError: null });
      } catch (e) {
        set({ assetsError: String((e as Error)?.message ?? e) });
      }
    },

    setShowSetup: (v) => set({ showSetup: v }),

    enterReplay: async (startTs) => {
      stopTimer();
      buffers.clear();
      const cursor = bucketStart(startTs, MINUTE);
      set({ active: true, showSetup: false, cursor, playing: false, atEnd: false });
      setReplayClock(() => get().cursor - 1);
      setReplayCandleSource(candleSource);
      // Replay only makes sense against the paper engine.
      useSettingsStore.getState().setMode('paper');

      const market = useMarketStore.getState();
      const loads: Promise<void>[] = [];
      for (const id of ['primary', 'secondary'] as PaneId[]) {
        if (market.panes[id]) loads.push(market.loadCandles(id));
      }
      await Promise.all(loads);

      // Seed mids from the last revealed close of each pane asset.
      const mids: Record<string, string> = {};
      for (const id of ['primary', 'secondary'] as PaneId[]) {
        const pane = useMarketStore.getState().panes[id];
        const last = pane?.candles[pane.candles.length - 1];
        if (pane && last) mids[pane.asset] = last.c;
      }
      useMarketStore.getState().batchUpdateMids(mids);
    },

    exitReplay: () => {
      stopTimer();
      setReplayClock(null);
      setReplayCandleSource(null);
      buffers.clear();
      set({ active: false, playing: false, atEnd: false, buffering: false });
      const market = useMarketStore.getState();
      for (const id of ['primary', 'secondary'] as PaneId[]) {
        if (market.panes[id]) void market.loadCandles(id);
      }
      void market.loadAllMids();
    },

    stepForward: async () => {
      if (!get().active || advancing || stepping) return;
      stepping = true;
      try {
        if (get().playing) {
          stopTimer();
          set({ playing: false });
        }
        const market = useMarketStore.getState();
        const pane = market.getActivePane();
        const ivMs = intervalToMs(pane.interval);
        const coins = relevantCoins();
        // Complete the interval bucket containing the next unrevealed candle.
        let nextT: number | null = null;
        for (const coin of coins) {
          const t = await findNextCandleTime(coin, get().cursor);
          if (t !== null && (nextT === null || t < nextT)) nextT = t;
        }
        if (nextT === null) {
          set({ atEnd: true });
          return;
        }
        const target = bucketStart(nextT, ivMs) + ivMs;
        while (get().active) {
          const { cursor } = get();
          let t: number | null = null;
          for (const coin of coins) {
            const ct = await findNextCandleTime(coin, cursor);
            if (ct !== null && (t === null || ct < t)) t = ct;
          }
          if (t === null) { set({ atEnd: true }); break; }
          if (t >= target) break;
          await advance(1);
        }
      } finally {
        stepping = false;
      }
    },

    togglePlay: () => {
      if (!get().active) return;
      if (get().playing) {
        stopTimer();
        set({ playing: false });
      } else {
        set({ playing: true, atEnd: false });
        startTimer();
      }
    },

    setSpeed: (n) => set({ speed: n }),
  };
});

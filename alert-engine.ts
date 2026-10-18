import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  validateAlert, crossSatisfied, closeSatisfied, sameCondition,
  type Alert, type AlertContext,
} from './src/services/ai/alerts.ts';
import { bucketStart, intervalToMs } from './src/services/replay/aggregate.ts';
import type { CandleInterval } from './src/types/market.ts';

/**
 * Watches Hyperliquid prices for armed alerts. Dev server only (used by
 * vite-ai-plugin.ts). Keeps one websocket open while anything is armed,
 * subscribed to allMids once per perp dex that has a cross alert (the
 * default allMids feed carries only the main dex; HIP-3 coins such as
 * "xyz:SP500" need `dex: "xyz"`) and to one candle stream per
 * (asset, interval) for close alerts. Alerts persist to a JSON file and the
 * constructor reconnects for them, so a dev server restart keeps them armed.
 * A ping every 30s and a watchdog that reopens a socket silent for 60s keep a
 * half-dead connection from hiding missed ticks.
 *
 * With `feed: 'manual'` (sim sessions) no socket is opened: the caller replays
 * recorded 1m bars through ingestBar() and `now` is the replay clock.
 */
const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const INFO_URL = 'https://api.hyperliquid.xyz/info';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PING_MS = 30_000;
const SILENT_MS = 60_000;
/** A feed mid older than this is not trusted as an alert's refPrice. */
const MID_FRESH_MS = 15_000;

/** Perp dex of a coin: "" for the main dex, "xyz" for "xyz:SP500". */
export function dexOf(asset: string): string {
  const i = asset.indexOf(':');
  return i > 0 ? asset.slice(0, i) : '';
}

/** Subscription key; '|' separates fields because HIP-3 coins contain ':'. */
export function midsKey(dex: string): string { return `mids|${dex}`; }
export function candleKey(coin: string, interval: string): string { return `candle|${coin}|${interval}`; }

export function subscriptionFor(key: string): Record<string, unknown> {
  const [kind, a, b] = key.split('|');
  if (kind === 'mids') return a ? { type: 'allMids', dex: a } : { type: 'allMids' };
  return { type: 'candle', coin: a, interval: b };
}

export interface AlertEngineDeps {
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
  now?: () => number;
  /** 'manual': never open the websocket; prices arrive through ingestBar(). */
  feed?: 'live' | 'manual';
}

/** A recorded 1m bar, as the replay data serves it. */
export interface SimBar { t: number; o: string; h: string; l: string; c: string }

type Listener = (alerts: Alert[], fired: Alert | null) => void;

interface CandleMsg { t: number; s: string; i: string; c: string }

export class AlertEngine {
  private alerts: Alert[] = [];
  private ws: WebSocket | null = null;
  private wanted = new Set<string>();
  private active = new Set<string>();
  private mids: Record<string, { px: number; at: number }> = {};
  private lastBar = new Map<string, { t: number; c: number }>();
  private listeners = new Set<Listener>();
  private waiters = new Map<string, Set<(a: Alert) => void>>();
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMsgAt = 0;
  private WS: typeof WebSocket;
  private fetchFn: typeof fetch;
  private now: () => number;
  private manual: boolean;

  constructor(private file: string, private log: (msg: string) => void = () => {}, deps: AlertEngineDeps = {}) {
    this.WS = deps.WebSocket ?? globalThis.WebSocket;
    this.fetchFn = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = deps.now ?? Date.now;
    this.manual = deps.feed === 'manual';
    this.load();
    const armed = this.alerts.filter(a => a.status === 'armed').length;
    if (armed) this.log(`loaded ${armed} armed alert(s) from ${this.file}`);
    this.sync();
  }

  list(): Alert[] { return this.alerts; }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Current mid for an asset if the feed has seen one. */
  mid(asset: string): number | null {
    return this.mids[asset]?.px ?? null;
  }

  /**
   * Manual feed: replay one 1m bar. Cross alerts see the bar's path (open,
   * the extreme nearer the open first, then the other, then close), so a wick
   * through a level fires. Close alerts see the bar as an update of the
   * interval candle containing it, which fires once the next bucket starts,
   * as the live candle feed does.
   */
  ingestBar(asset: string, bar: SimBar): void {
    const [o, h, l, c] = [bar.o, bar.h, bar.l, bar.c].map(Number);
    const path = Math.abs(h - o) <= Math.abs(o - l) ? [o, h, l, c] : [o, l, h, c];
    for (const px of path) this.onMessage({ channel: 'allMids', data: { mids: { [asset]: String(px) } } });
    const intervals = new Set(this.alerts
      .filter(a => a.status === 'armed' && a.kind === 'close' && a.asset === asset && a.interval)
      .map(a => a.interval!));
    for (const i of intervals) {
      const t = bucketStart(bar.t, intervalToMs(i as CandleInterval));
      this.onMessage({ channel: 'candle', data: { t, s: asset, i, c: bar.c } });
    }
  }

  /** A fresh mid: the feed's if it is recent, else one fetched from the info API; null if neither works. */
  async freshMid(asset: string): Promise<number | null> {
    const m = this.mids[asset];
    if (m && this.now() - m.at < MID_FRESH_MS) return m.px;
    if (this.manual) return m?.px ?? null;
    const dex = dexOf(asset);
    try {
      const res = await this.fetchFn(INFO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dex ? { type: 'allMids', dex } : { type: 'allMids' }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mids = await res.json() as Record<string, string>;
      const px = parseFloat(mids?.[asset]);
      if (!Number.isFinite(px)) return null;
      this.mids[asset] = { px, at: this.now() };
      return px;
    } catch (e) {
      this.log(`mid fetch for ${asset} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Validate and arm. An identical armed alert is returned instead of duplicated. */
  add(input: unknown, ctx: Omit<AlertContext, 'id'>): { alert: Alert; existing: boolean } {
    const id = `al_${Date.now().toString(36)}${(++this.seq).toString(36)}`;
    const alert = validateAlert(input, { now: this.now(), ...ctx, id });
    const dup = this.alerts.find(a => a.status === 'armed' && sameCondition(a, alert));
    if (dup) return { alert: dup, existing: true };
    this.alerts.push(alert);
    this.save();
    this.sync();
    this.emit(null);
    return { alert, existing: false };
  }

  remove(id: string): boolean {
    const before = this.alerts.length;
    this.alerts = this.alerts.filter(a => a.id !== id);
    if (this.alerts.length === before) return false;
    this.waiters.delete(id);
    this.save();
    this.sync();
    this.emit(null);
    return true;
  }

  clear(): void {
    this.alerts = [];
    this.waiters.clear();
    this.save();
    this.sync();
    this.emit(null);
  }

  /** Resolves with the alert once it has fired, or null after timeoutMs; undefined if the id is unknown. */
  wait(id: string, timeoutMs: number): Promise<Alert | null | undefined> {
    const a = this.alerts.find(x => x.id === id);
    if (!a) return Promise.resolve(undefined);
    if (a.status === 'fired') return Promise.resolve(a);
    return new Promise(resolve => {
      const set = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, set);
      const done = (x: Alert) => { clearTimeout(timer); set.delete(done); resolve(x); };
      const timer = setTimeout(() => { set.delete(done); resolve(null); }, timeoutMs);
      set.add(done);
    });
  }

  close(): void {
    this.wanted.clear();
    this.dropSocket();
  }

  /* ----------------------------------------------------------- feed --- */

  /** Make the socket's subscriptions match the armed alerts. */
  private sync(): void {
    const next = new Set<string>();
    for (const a of this.alerts) {
      if (a.status !== 'armed') continue;
      next.add(a.kind === 'cross' ? midsKey(dexOf(a.asset)) : candleKey(a.asset, a.interval ?? ''));
    }
    this.wanted = next;
    if (this.manual) return;
    if (next.size === 0) { this.dropSocket(); return; }
    if (!this.ws) { this.connect(); return; }
    if (this.ws.readyState === this.WS.OPEN) this.applySubscriptions();
  }

  private connect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    let ws: WebSocket;
    try { ws = new this.WS(WS_URL); } catch (e) { this.log(`ws open failed: ${(e as Error).message}`); this.scheduleReconnect(); return; }
    this.ws = ws;
    this.active.clear();
    this.lastMsgAt = this.now();
    ws.onopen = () => {
      this.log(`feed connected (${[...this.wanted].join(', ')})`);
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.lastMsgAt = this.now();
      this.applySubscriptions();
    };
    ws.onmessage = ev => {
      this.lastMsgAt = this.now();
      let msg: unknown;
      try { msg = JSON.parse(String(ev.data)); } catch { return; /* ignore non-JSON */ }
      try { this.onMessage(msg as { channel?: string; data?: unknown }); } catch (e) { this.log(`message handling failed: ${(e as Error).message}`); }
    };
    ws.onerror = ev => {
      this.log(`feed error: ${(ev as { message?: string }).message ?? 'unknown'}`);
      try { ws.close(); } catch { /* ignore */ }
    };
    ws.onclose = ev => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.active.clear();
      this.stopPing();
      this.log(`feed closed (code ${(ev as { code?: number }).code ?? '?'})${this.wanted.size > 0 ? ', reconnecting' : ''}`);
      if (this.wanted.size > 0) this.scheduleReconnect();
    };
    this.startPing();
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      if (this.now() - this.lastMsgAt > SILENT_MS) {
        this.log(`feed silent for ${Math.round((this.now() - this.lastMsgAt) / 1000)}s, reopening`);
        this.ws = null;
        this.active.clear();
        this.stopPing();
        try { ws.close(); } catch { /* ignore */ }
        this.scheduleReconnect();
        return;
      }
      if (ws.readyState === this.WS.OPEN) {
        try { ws.send(JSON.stringify({ method: 'ping' })); } catch { /* onclose handles it */ }
      }
    }, PING_MS);
    (this.pingTimer as { unref?: () => void }).unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (this.wanted.size > 0) this.connect(); }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private dropSocket(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    this.active.clear();
    this.lastBar.clear();
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
  }

  private applySubscriptions(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== this.WS.OPEN) return;
    for (const key of this.active) {
      if (!this.wanted.has(key)) {
        ws.send(JSON.stringify({ method: 'unsubscribe', subscription: subscriptionFor(key) }));
        this.active.delete(key);
        this.lastBar.delete(key);
      }
    }
    for (const key of this.wanted) {
      if (!this.active.has(key)) {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: subscriptionFor(key) }));
        this.active.add(key);
        // A cached bar from before this subscription is stale.
        this.lastBar.delete(key);
      }
    }
  }

  private onMessage(msg: { channel?: string; data?: unknown }): void {
    if (msg.channel === 'allMids') {
      const mids = (msg.data as { mids?: Record<string, string> } | undefined)?.mids;
      if (!mids) return;
      const at = this.now();
      for (const [coin, px] of Object.entries(mids)) {
        const n = parseFloat(px);
        if (Number.isFinite(n)) this.mids[coin] = { px: n, at };
      }
      for (const a of this.alerts) {
        if (a.status !== 'armed' || a.kind !== 'cross') continue;
        const px = mids[a.asset];
        if (px === undefined) continue;
        const mid = parseFloat(px);
        if (Number.isFinite(mid) && crossSatisfied(a, mid)) this.fire(a, mid);
      }
      return;
    }
    if (msg.channel === 'candle') {
      const c = msg.data as CandleMsg | undefined;
      if (!c || typeof c.t !== 'number') return;
      const key = candleKey(c.s, c.i);
      const close = parseFloat(c.c);
      const prev = this.lastBar.get(key);
      if (prev && c.t > prev.t) {
        // The bar we were watching is closed; its last close is the bar's close.
        // Only alerts armed before that bar closed may fire on it.
        const prevCloseT = prev.t + intervalToMs(c.i as CandleInterval);
        for (const a of this.alerts) {
          if (a.status !== 'armed' || a.kind !== 'close' || a.asset !== c.s || a.interval !== c.i) continue;
          if (prevCloseT <= a.createdAt) continue;
          if (closeSatisfied(a, prev.c)) this.fire(a, prev.c, prev.t);
        }
      }
      // Firing may have dropped this stream; don't cache a bar nothing updates.
      if (!this.wanted.has(key)) { this.lastBar.delete(key); return; }
      if (Number.isFinite(close)) this.lastBar.set(key, { t: c.t, c: close });
    }
  }

  private fire(a: Alert, price: number, barT?: number): void {
    a.status = 'fired';
    a.firedAt = this.now();
    a.firedPrice = price;
    if (barT !== undefined) a.firedBarT = barT;
    this.log(`fired ${a.id}: ${a.asset} ${a.kind} ${a.direction} ${a.level} at ${price}`);
    this.save();
    this.sync();
    for (const done of this.waiters.get(a.id) ?? []) done(a);
    this.waiters.delete(a.id);
    this.emit(a);
  }

  private emit(fired: Alert | null): void {
    for (const fn of this.listeners) {
      try { fn(this.alerts, fired); } catch (e) { this.log(`listener failed: ${(e as Error).message}`); }
    }
  }

  /* -------------------------------------------------------- storage --- */

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { alerts?: Alert[] };
      this.alerts = Array.isArray(parsed.alerts) ? parsed.alerts : [];
    } catch (e) {
      this.log(`could not read ${this.file}: ${(e as Error).message}`);
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ alerts: this.alerts }, null, 2));
      renameSync(tmp, this.file);
    } catch (e) {
      this.log(`could not write ${this.file}: ${(e as Error).message}`);
    }
  }
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  validateAlert, crossSatisfied, closeSatisfied, sameCondition,
  type Alert, type AlertContext,
} from './src/services/ai/alerts.ts';

/**
 * Watches Hyperliquid prices for armed alerts. Dev server only (used by
 * vite-ai-plugin.ts). Keeps one websocket open while anything is armed,
 * subscribed to allMids for cross alerts and to one candle stream per
 * (asset, interval) for close alerts. Alerts persist to a JSON file so a
 * dev server restart keeps them.
 */
const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

type Listener = (alerts: Alert[], fired: Alert | null) => void;

interface CandleMsg { t: number; s: string; i: string; c: string }

export class AlertEngine {
  private alerts: Alert[] = [];
  private ws: WebSocket | null = null;
  private wanted = new Set<string>();
  private active = new Set<string>();
  private mids: Record<string, number> = {};
  private lastBar = new Map<string, { t: number; c: number }>();
  private listeners = new Set<Listener>();
  private waiters = new Map<string, Set<(a: Alert) => void>>();
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(private file: string, private log: (msg: string) => void = () => {}) {
    this.load();
    this.sync();
  }

  list(): Alert[] { return this.alerts; }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Current mid for an asset if the feed has seen one. */
  mid(asset: string): number | null {
    return this.mids[asset] ?? null;
  }

  /** Validate and arm. An identical armed alert is returned instead of duplicated. */
  add(input: unknown, ctx: Omit<AlertContext, 'id'>): { alert: Alert; existing: boolean } {
    const id = `al_${Date.now().toString(36)}${(++this.seq).toString(36)}`;
    const alert = validateAlert(input, { ...ctx, id });
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
      next.add(a.kind === 'cross' ? 'allMids' : `candle:${a.asset}:${a.interval}`);
    }
    this.wanted = next;
    if (next.size === 0) { this.dropSocket(); return; }
    if (!this.ws) { this.connect(); return; }
    if (this.ws.readyState === WebSocket.OPEN) this.applySubscriptions();
  }

  private connect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    let ws: WebSocket;
    try { ws = new WebSocket(WS_URL); } catch (e) { this.log(`ws open failed: ${(e as Error).message}`); this.scheduleReconnect(); return; }
    this.ws = ws;
    this.active.clear();
    ws.onopen = () => { this.reconnectDelay = RECONNECT_MIN_MS; this.applySubscriptions(); };
    ws.onmessage = ev => {
      try { this.onMessage(JSON.parse(String(ev.data))); } catch { /* ignore non-JSON */ }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.active.clear();
      if (this.wanted.size > 0) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (this.wanted.size > 0) this.connect(); }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private dropSocket(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    this.active.clear();
    this.lastBar.clear();
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
  }

  private subscription(key: string): Record<string, unknown> {
    if (key === 'allMids') return { type: 'allMids' };
    const [, coin, interval] = key.split(':');
    return { type: 'candle', coin, interval };
  }

  private applySubscriptions(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const key of this.active) {
      if (!this.wanted.has(key)) {
        ws.send(JSON.stringify({ method: 'unsubscribe', subscription: this.subscription(key) }));
        this.active.delete(key);
        this.lastBar.delete(key);
      }
    }
    for (const key of this.wanted) {
      if (!this.active.has(key)) {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: this.subscription(key) }));
        this.active.add(key);
      }
    }
  }

  private onMessage(msg: { channel?: string; data?: unknown }): void {
    if (msg.channel === 'allMids') {
      const mids = (msg.data as { mids?: Record<string, string> } | undefined)?.mids;
      if (!mids) return;
      for (const [coin, px] of Object.entries(mids)) {
        const n = parseFloat(px);
        if (Number.isFinite(n)) this.mids[coin] = n;
      }
      for (const a of this.alerts) {
        if (a.status !== 'armed' || a.kind !== 'cross') continue;
        const mid = this.mids[a.asset];
        if (mid !== undefined && crossSatisfied(a, mid)) this.fire(a, mid);
      }
      return;
    }
    if (msg.channel === 'candle') {
      const c = msg.data as CandleMsg | undefined;
      if (!c || typeof c.t !== 'number') return;
      const key = `candle:${c.s}:${c.i}`;
      const close = parseFloat(c.c);
      const prev = this.lastBar.get(key);
      if (prev && c.t > prev.t) {
        // The bar we were watching is closed; its last close is the bar's close.
        for (const a of this.alerts) {
          if (a.status !== 'armed' || a.kind !== 'close' || a.asset !== c.s || a.interval !== c.i) continue;
          if (closeSatisfied(a, prev.c)) this.fire(a, prev.c, prev.t);
        }
      }
      if (Number.isFinite(close)) this.lastBar.set(key, { t: c.t, c: close });
    }
  }

  private fire(a: Alert, price: number, barT?: number): void {
    a.status = 'fired';
    a.firedAt = Date.now();
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

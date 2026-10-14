/**
 * Trade proposals: the AI proposes an order, cancel, TP/SL change or close; the
 * open page shows it as a confirm card and, once the user confirms, signs and
 * sends it with the key it already holds. The dev server only stores
 * proposals and relays decisions; it never holds a key or talks to the
 * exchange. Used by the Vite plugin, the page, and (as JSON) the MCP server.
 *
 * Lifecycle:
 *   pending -> executing (a page claimed it) -> done | failed
 *   pending -> rejected (user) | withdrawn (AI) | expired (nobody decided in time)
 *   executing -> failed when the page never reports back.
 */

export type TradeMode = 'paper' | 'live';
export type TradeStatus = 'pending' | 'executing' | 'done' | 'failed' | 'rejected' | 'withdrawn' | 'expired';
export type OrderId = number | string;

export interface OrderAction {
  kind: 'order';
  coin: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  /** Limit price; required for limit orders. */
  price?: number;
  /** Exactly one of size (asset units), sizeUsd (notional) or riskUsd (loss at sl). */
  size?: number;
  sizeUsd?: number;
  riskUsd?: number;
  tif?: 'Gtc' | 'Ioc' | 'Alo';
  reduceOnly?: boolean;
  tp?: number;
  sl?: number;
  leverage?: number;
  /** Cancel this resting order once the new one is accepted (move an entry). */
  replaceOid?: OrderId;
}

export interface TpSlAction {
  kind: 'tpsl';
  coin: string;
  tpsl: 'tp' | 'sl';
  /** Trigger price for a reduce-only market TP/SL on the whole position. */
  price: number;
  /** Cancel this trigger once the new one is accepted (move a stop or target). */
  replaceOid?: OrderId;
}

export interface CancelAction {
  kind: 'cancel';
  coin: string;
  /** Order ids, or 'all' for every open order on the coin. */
  oids: OrderId[] | 'all';
}

export interface CloseAction {
  kind: 'close';
  coin: string;
}

export type TradeAction = OrderAction | TpSlAction | CancelAction | CloseAction;

export interface TradeResult {
  ok: boolean;
  message: string;
}

export interface TradeProposal {
  id: string;
  action: TradeAction;
  /** Why the AI wants this; shown on the card. */
  note?: string;
  /** Mode the proposal was made for; the page refuses to run it in the other mode. */
  mode: TradeMode;
  createdAt: number;
  expiresAt: number;
  status: TradeStatus;
  decidedAt?: number;
  /** 'auto' when the page's auto-confirm setting ran it. */
  decidedBy?: 'user' | 'auto';
  claimedAt?: number;
  result?: TradeResult;
}

export const MAX_TRADE_NOTE = 300;
export const DEFAULT_EXPIRY_SEC = 900;
export const MAX_EXPIRY_SEC = 86_400;
/** A claimed proposal whose page never reports back is marked failed after this. */
export const EXECUTING_TIMEOUT_MS = 60_000;
/** Finished proposals kept for get_chart_view and the panel. */
const KEEP_FINISHED = 20;

export const isOpen = (s: TradeStatus) => s === 'pending' || s === 'executing';

export class TradeValidationError extends Error {}

const fail = (msg: string): never => { throw new TradeValidationError(msg); };

function num(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`${name} must be a positive number`);
  return n;
}

function oid(v: unknown, name: string): OrderId | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string' && v.trim()) return /^\d+$/.test(v.trim()) ? Number(v.trim()) : v.trim();
  return fail(`${name} must be an order id from get_chart_view orders`);
}

function sideOf(v: unknown): 'buy' | 'sell' {
  if (v === 'buy' || v === 'long') return 'buy';
  if (v === 'sell' || v === 'short') return 'sell';
  return fail('side must be "buy"/"long" or "sell"/"short"');
}

/** Validate a raw action, filling the coin from the charted asset. Throws TradeValidationError. */
export function normalizeTradeAction(raw: unknown, defaultAsset: string | null): TradeAction {
  if (!raw || typeof raw !== 'object') fail('action must be an object');
  const a = raw as Record<string, unknown>;
  const coin = typeof a.coin === 'string' && a.coin.trim() ? a.coin.trim() : defaultAsset;
  if (!coin) fail('coin is required (no chart connected to default from)');

  switch (a.kind) {
    case 'order': {
      const side = sideOf(a.side);
      const price = num(a.price, 'price');
      const orderType = a.orderType ?? (price !== undefined ? 'limit' : undefined);
      if (orderType !== 'limit' && orderType !== 'market') fail('orderType must be "limit" or "market"');
      if (orderType === 'limit' && price === undefined) fail('a limit order needs price');
      if (orderType === 'market' && price !== undefined) fail('a market order takes no price');
      const size = num(a.size, 'size');
      const sizeUsd = num(a.sizeUsd, 'sizeUsd');
      const riskUsd = num(a.riskUsd, 'riskUsd');
      const given = [size, sizeUsd, riskUsd].filter(x => x !== undefined).length;
      if (given !== 1) fail('give exactly one of size, sizeUsd or riskUsd');
      const tp = num(a.tp, 'tp');
      const sl = num(a.sl, 'sl');
      if (riskUsd !== undefined && sl === undefined) fail('riskUsd sizing needs sl');
      const reduceOnly = a.reduceOnly === true;
      if (reduceOnly && (tp !== undefined || sl !== undefined)) fail('a reduce-only order takes no tp/sl; use propose_tpsl');
      const tif = a.tif;
      if (tif !== undefined && tif !== 'Gtc' && tif !== 'Ioc' && tif !== 'Alo') fail('tif must be Gtc, Ioc or Alo');
      if (tif !== undefined && orderType === 'market') fail('a market order takes no tif');
      let leverage: number | undefined;
      if (a.leverage !== undefined && a.leverage !== null) {
        leverage = Number(a.leverage);
        if (!Number.isInteger(leverage) || leverage < 1 || leverage > 100) fail('leverage must be a whole number from 1 to 100');
      }
      const replaceOid = oid(a.replaceOid, 'replaceOid');
      const out: OrderAction = { kind: 'order', coin: coin!, side, orderType: orderType as OrderAction['orderType'] };
      if (price !== undefined) out.price = price;
      if (size !== undefined) out.size = size;
      if (sizeUsd !== undefined) out.sizeUsd = sizeUsd;
      if (riskUsd !== undefined) out.riskUsd = riskUsd;
      if (tif !== undefined) out.tif = tif as OrderAction['tif'];
      if (reduceOnly) out.reduceOnly = true;
      if (tp !== undefined) out.tp = tp;
      if (sl !== undefined) out.sl = sl;
      if (leverage !== undefined) out.leverage = leverage;
      if (replaceOid !== undefined) out.replaceOid = replaceOid;
      return out;
    }
    case 'tpsl': {
      if (a.tpsl !== 'tp' && a.tpsl !== 'sl') fail('tpsl must be "tp" or "sl"');
      const price = num(a.price, 'price');
      if (price === undefined) fail('price is required');
      const replaceOid = oid(a.replaceOid, 'replaceOid');
      return { kind: 'tpsl', coin: coin!, tpsl: a.tpsl as 'tp' | 'sl', price: price!, ...(replaceOid !== undefined ? { replaceOid } : {}) };
    }
    case 'cancel': {
      if (a.oids === 'all' || a.all === true) return { kind: 'cancel', coin: coin!, oids: 'all' };
      const list = Array.isArray(a.oids) ? a.oids : a.oids === undefined ? [] : [a.oids];
      const oids = list.map((v, i) => oid(v, `oids[${i}]`)!).filter(v => v !== undefined);
      if (!oids.length) fail('give oids (from get_chart_view orders) or all: true');
      if (new Set(oids.map(String)).size !== oids.length) fail('oids has duplicates');
      return { kind: 'cancel', coin: coin!, oids };
    }
    case 'close':
      return { kind: 'close', coin: coin! };
    default:
      return fail('kind must be order, tpsl, cancel or close');
  }
}

/** One-line description, used in logs, the wait script and card titles. */
export function describeAction(a: TradeAction): string {
  const fmt = (n: number | undefined) => (n === undefined ? '' : String(n));
  switch (a.kind) {
    case 'order': {
      const size = a.size !== undefined ? `${a.size} ${a.coin}` : a.sizeUsd !== undefined ? `$${a.sizeUsd} of ${a.coin}` : `${a.coin} risking $${a.riskUsd}`;
      const where = a.orderType === 'market' ? 'market' : `limit @ ${a.price}`;
      const bracket = [a.tp !== undefined ? `TP ${fmt(a.tp)}` : '', a.sl !== undefined ? `SL ${fmt(a.sl)}` : ''].filter(Boolean).join(', ');
      return `${a.side === 'buy' ? 'Buy' : 'Sell'} ${size} ${where}${a.reduceOnly ? ' reduce-only' : ''}${bracket ? ` (${bracket})` : ''}${a.replaceOid !== undefined ? `, replacing #${a.replaceOid}` : ''}`;
    }
    case 'tpsl':
      return `${a.tpsl.toUpperCase()} on ${a.coin} position at ${a.price}${a.replaceOid !== undefined ? `, replacing #${a.replaceOid}` : ''}`;
    case 'cancel':
      return a.oids === 'all' ? `Cancel all ${a.coin} orders` : `Cancel ${a.coin} order${a.oids.length > 1 ? 's' : ''} ${a.oids.map(o => `#${o}`).join(', ')}`;
    case 'close':
      return `Market close ${a.coin} position`;
  }
}

/* --------------------------------------------------------------- desk --- */

export interface ProposeContext {
  defaultAsset: string | null;
  /** The page's current mode; used when the input does not name one. */
  mode: TradeMode | null;
}

export interface TradeDeskOptions {
  now?: () => number;
  newId?: () => string;
}

let idSeq = 0;
const defaultId = () => `t${Date.now().toString(36)}${(++idSeq).toString(36)}`;

/** In-memory proposal store. Pure apart from the clock; the plugin calls sweep() on a timer. */
export class TradeDesk {
  private trades: TradeProposal[] = [];
  private listeners = new Set<() => void>();
  private waiters = new Map<string, Set<(t: TradeProposal) => void>>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(opts: TradeDeskOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): TradeProposal[] {
    return this.trades.map(t => ({ ...t }));
  }

  get(id: string): TradeProposal | undefined {
    const t = this.trades.find(x => x.id === id);
    return t ? { ...t } : undefined;
  }

  propose(raw: unknown, ctx: ProposeContext): TradeProposal {
    if (!raw || typeof raw !== 'object') fail('body must be an object');
    const body = raw as Record<string, unknown>;
    const action = normalizeTradeAction(body.action, ctx.defaultAsset);
    const mode = body.mode ?? ctx.mode;
    if (mode !== 'paper' && mode !== 'live') fail('mode must be "paper" or "live" (no chart connected to default from)');
    let note: string | undefined;
    if (body.note !== undefined && body.note !== null) {
      if (typeof body.note !== 'string') fail('note must be a string');
      note = (body.note as string).trim().slice(0, MAX_TRADE_NOTE) || undefined;
    }
    let expiry = DEFAULT_EXPIRY_SEC;
    if (body.expiresInSec !== undefined && body.expiresInSec !== null) {
      expiry = Number(body.expiresInSec);
      if (!Number.isFinite(expiry) || expiry < 30 || expiry > MAX_EXPIRY_SEC) fail(`expiresInSec must be from 30 to ${MAX_EXPIRY_SEC}`);
    }
    const now = this.now();
    const t: TradeProposal = {
      id: this.newId(), action, mode: mode as TradeMode, createdAt: now,
      expiresAt: now + Math.round(expiry * 1000), status: 'pending',
      ...(note ? { note } : {}),
    };
    this.trades.push(t);
    this.changed();
    return { ...t };
  }

  /** A page takes a pending proposal to execute it. Only the first claim wins. */
  claim(id: string, decidedBy: 'user' | 'auto' = 'user'): { ok: true; trade: TradeProposal } | { ok: false; error: string } {
    this.sweep();
    const t = this.trades.find(x => x.id === id);
    if (!t) return { ok: false, error: `no proposal with id ${id}` };
    if (t.status !== 'pending') return { ok: false, error: `proposal is ${t.status}` };
    t.status = 'executing';
    t.claimedAt = this.now();
    t.decidedAt = t.claimedAt;
    t.decidedBy = decidedBy;
    this.changed();
    return { ok: true, trade: { ...t } };
  }

  /** The page reports what the exchange (or paper engine) answered. */
  finish(id: string, result: unknown): TradeProposal | null {
    const t = this.trades.find(x => x.id === id);
    if (!t || t.status !== 'executing') return null;
    const r = (result ?? {}) as Partial<TradeResult>;
    t.result = { ok: r.ok === true, message: typeof r.message === 'string' ? r.message.slice(0, 1000) : '' };
    t.status = t.result.ok ? 'done' : 'failed';
    this.settle(t);
    return { ...t };
  }

  reject(id: string, reason?: string): TradeProposal | null {
    return this.close(id, 'rejected', reason?.trim() ? reason.trim().slice(0, 300) : 'rejected by the user');
  }

  withdraw(id: string): TradeProposal | null {
    return this.close(id, 'withdrawn', 'withdrawn by the AI');
  }

  /** Expire stale pending proposals and fail claims whose page went away. */
  sweep(): void {
    const now = this.now();
    let dirty = false;
    for (const t of this.trades) {
      if (t.status === 'pending' && now >= t.expiresAt) {
        t.status = 'expired';
        t.decidedAt = now;
        t.result = { ok: false, message: 'nobody confirmed it before it expired' };
        this.notify(t);
        dirty = true;
      } else if (t.status === 'executing' && t.claimedAt !== undefined && now - t.claimedAt >= EXECUTING_TIMEOUT_MS) {
        t.status = 'failed';
        t.result = { ok: false, message: 'the page claimed it but never reported a result; check the account before retrying' };
        this.notify(t);
        dirty = true;
      }
    }
    if (dirty) { this.prune(); this.changed(); }
  }

  /** Resolve with the proposal once it leaves pending/executing; null on timeout; undefined if unknown. */
  wait(id: string, timeoutMs: number): Promise<TradeProposal | null | undefined> {
    this.sweep();
    const t = this.trades.find(x => x.id === id);
    if (!t) return Promise.resolve(undefined);
    if (!isOpen(t.status)) return Promise.resolve({ ...t });
    return new Promise(resolve => {
      const set = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, set);
      const done = (x: TradeProposal | null) => { clearTimeout(timer); set.delete(fn); resolve(x); };
      const fn = (x: TradeProposal) => done({ ...x });
      const timer = setTimeout(() => done(null), timeoutMs);
      set.add(fn);
    });
  }

  private close(id: string, status: 'rejected' | 'withdrawn', message: string): TradeProposal | null {
    const t = this.trades.find(x => x.id === id);
    if (!t || t.status !== 'pending') return null;
    t.status = status;
    t.decidedAt = this.now();
    t.result = { ok: false, message };
    this.settle(t);
    return { ...t };
  }

  private settle(t: TradeProposal): void {
    this.notify(t);
    this.prune();
    this.changed();
  }

  private notify(t: TradeProposal): void {
    for (const fn of [...(this.waiters.get(t.id) ?? [])]) fn(t);
    this.waiters.delete(t.id);
  }

  private prune(): void {
    const finished = this.trades.filter(t => !isOpen(t.status));
    if (finished.length <= KEEP_FINISHED) return;
    const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map(t => t.id));
    this.trades = this.trades.filter(t => !drop.has(t.id));
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}

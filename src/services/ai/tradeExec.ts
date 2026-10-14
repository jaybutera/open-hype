/**
 * Page side of AI trade proposals: turn a proposal into exactly what will be
 * sent (the confirm card shows it), and run it once the user confirms. Live
 * trades go through liveTrader.ts with the agent key this page holds; paper
 * trades go to the running paper engine. Either way the result lands in the
 * same stores the rest of the UI reads, so orders and positions show up on the
 * chart and in the tables like ones placed by hand.
 */
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useWalletStore } from '../../store/useWalletStore.ts';
import { useLiveAccountStore } from '../../store/useLiveAccountStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useReplayStore } from '../../store/useReplayStore.ts';
import {
  prepareOrder, submitPrepared, placeLivePositionTrigger, closeLivePosition, cancelLiveOrders, resolveAsset,
  type PreparedOrder, type LiveResult,
} from '../hl/liveTrader.ts';
import { formatSize } from '../hl/format.ts';
import { getPaperEngine, liveTpsl } from './link.ts';
import type { OrderAction, TpSlAction, TradeAction, TradeProposal, TradeResult, OrderId } from './trades.ts';
import type { Side } from '../../types/order.ts';

export interface TradePreview {
  /** What will be sent, one fact per line. */
  lines: string[];
  /** Live orders: the exact signed payload, rendered with LiveOrderConfirm. */
  prepared?: PreparedOrder;
}

/** An order as both modes describe it, for cancels and replacements. */
interface Target {
  oid: OrderId;
  side: Side;
  price: number;
  reduceOnly: boolean;
  tpsl?: 'tp' | 'sl';
  label: string;
}

function mid(coin: string): number {
  const m = parseFloat(useMarketStore.getState().allMids[coin] ?? '');
  if (!(m > 0)) throw new Error(`No live price for ${coin}`);
  return m;
}

function ordersOn(coin: string, mode: 'paper' | 'live'): Target[] {
  if (mode === 'live') {
    return useLiveAccountStore.getState().openOrders.filter(o => o.coin === coin).map(o => {
      const tpsl = o.isTrigger ? liveTpsl(o.orderType) : undefined;
      const price = parseFloat(o.isTrigger ? o.triggerPx : o.limitPx);
      return {
        oid: o.oid, side: o.side, price, reduceOnly: o.reduceOnly, tpsl,
        label: `#${o.oid} ${o.side} ${o.sz} ${o.orderType} @ ${price}`,
      };
    });
  }
  return useAccountStore.getState().paperOrders.filter(o => o.coin === coin).map(o => {
    const price = (o.type === 'trigger' && o.triggerPx ? o.triggerPx : o.price).toNumber();
    return {
      oid: o.id, side: o.side, price, reduceOnly: o.reduceOnly, tpsl: o.type === 'trigger' ? o.tpsl : undefined,
      label: `#${o.id} ${o.side} ${o.size.toString()} ${o.type === 'trigger' ? `${o.tpsl ?? 'trigger'}` : 'limit'} @ ${price}`,
    };
  });
}

/** Signed position size (+ long, - short), 0 when flat. */
function positionSize(coin: string, mode: 'paper' | 'live'): number {
  if (mode === 'live') return useLiveAccountStore.getState().positions.find(p => p.coin === coin)?.szi ?? 0;
  return useAccountStore.getState().paperPositions.find(p => p.coin === coin)?.szi.toNumber() ?? 0;
}

function findTarget(coin: string, mode: 'paper' | 'live', oid: OrderId): Target {
  const t = ordersOn(coin, mode).find(o => String(o.oid) === String(oid));
  if (!t) throw new Error(`No open ${coin} order #${oid}`);
  return t;
}

/** Size in asset units from size, sizeUsd or riskUsd. */
export function resolveSize(a: OrderAction, refPx: number): number {
  if (a.size !== undefined) return a.size;
  if (a.sizeUsd !== undefined) return a.sizeUsd / refPx;
  const dist = Math.abs(refPx - (a.sl as number));
  if (!(dist > 0)) throw new Error('Entry and SL are the same price; cannot size by risk');
  return (a.riskUsd as number) / dist;
}

/** TP above and SL below the price for a long, the reverse for a short. */
function checkBracket(isLong: boolean, refPx: number, tp?: number, sl?: number) {
  if (tp !== undefined && (tp > refPx) !== isLong) throw new Error(`TP ${tp} is on the wrong side of ${refPx} for a ${isLong ? 'long' : 'short'}`);
  if (sl !== undefined && (sl < refPx) !== isLong) throw new Error(`SL ${sl} is on the wrong side of ${refPx} for a ${isLong ? 'long' : 'short'}`);
}

function checkMode(t: TradeProposal) {
  const mode = useSettingsStore.getState().mode;
  if (mode !== t.mode) throw new Error(`Proposed for ${t.mode}; switch the app to ${t.mode} mode to confirm`);
  if (mode === 'live' && useWalletStore.getState().tradingStatus !== 'ready') {
    throw new Error('Connect a wallet and enable trading first');
  }
}

/** Paper size rounded down to the asset's lot size, like a live order would be. */
async function paperSize(coin: string, size: number): Promise<number> {
  let rounded: number;
  try {
    rounded = Number(formatSize(size, (await resolveAsset(coin)).szDecimals));
  } catch {
    rounded = Number(size.toPrecision(8));
  }
  if (!(rounded > 0)) throw new Error(`Size ${size} rounds to zero for ${coin}`);
  return rounded;
}

/** Build what the card shows. Throws a user-facing Error when the proposal cannot run right now. */
export async function previewTrade(t: TradeProposal): Promise<TradePreview> {
  checkMode(t);
  const a = t.action;
  const lines: string[] = [];
  if (t.mode === 'live' && useReplayStore.getState().active) lines.push('Replay is on, but this goes to the real exchange.');

  switch (a.kind) {
    case 'order': {
      const refPx = a.orderType === 'market' ? mid(a.coin) : (a.price as number);
      const size = resolveSize(a, refPx);
      const replaced = a.replaceOid !== undefined ? findTarget(a.coin, t.mode, a.replaceOid) : null;
      if (replaced) lines.push(`Then cancels ${replaced.label}`);
      if (a.riskUsd !== undefined) lines.push(`Sized for $${a.riskUsd} risk to SL ${a.sl}`);
      if (t.mode === 'live') {
        const prepared = await prepareOrder({
          coin: a.coin, side: a.side, size, kind: a.orderType, price: a.price, tif: a.tif,
          reduceOnly: a.reduceOnly, tp: a.tp, sl: a.sl, leverage: a.leverage,
        });
        return { lines, prepared };
      }
      checkBracket(a.side === 'buy', refPx, a.tp, a.sl);
      if (a.reduceOnly && positionSize(a.coin, 'paper') === 0) throw new Error(`No ${a.coin} position to reduce`);
      const lot = await paperSize(a.coin, size);
      lines.unshift(
        `${a.side === 'buy' ? 'BUY' : 'SELL'} ${lot} ${a.coin} ${a.orderType === 'market' ? `market (mid ${refPx})` : `limit @ ${refPx}`}${a.reduceOnly ? ' reduce-only' : ''}`,
        `≈ $${(lot * refPx).toFixed(2)}${a.tp !== undefined ? ` · TP ${a.tp}` : ''}${a.sl !== undefined ? ` · SL ${a.sl}` : ''}`,
      );
      if (a.leverage !== undefined) lines.push(`Leverage ${a.leverage}x is ignored in paper; the app setting applies`);
      return { lines };
    }
    case 'tpsl': {
      const szi = positionSize(a.coin, t.mode);
      if (szi === 0) throw new Error(`No open ${a.coin} position`);
      const isLong = szi > 0;
      const m = mid(a.coin);
      checkBracket(isLong, m, a.tpsl === 'tp' ? a.price : undefined, a.tpsl === 'sl' ? a.price : undefined);
      const replaced = a.replaceOid !== undefined ? findTarget(a.coin, t.mode, a.replaceOid) : null;
      if (replaced && !replaced.reduceOnly && !replaced.tpsl) throw new Error(`#${replaced.oid} is not a TP/SL order`);
      lines.push(`${a.tpsl.toUpperCase()} ${a.coin} ${isLong ? 'long' : 'short'} ${Math.abs(szi)} at ${a.price} (market, reduce-only; mid ${m})`);
      if (replaced) lines.push(`Then cancels ${replaced.label}`);
      return { lines };
    }
    case 'cancel': {
      const all = ordersOn(a.coin, t.mode);
      const targets = a.oids === 'all' ? all : a.oids.map(o => findTarget(a.coin, t.mode, o));
      if (!targets.length) throw new Error(`No open ${a.coin} orders`);
      lines.push(...targets.map(o => `Cancel ${o.label}`));
      if (targets.some(o => o.reduceOnly || o.tpsl)) lines.push('Includes TP/SL orders: the position loses that protection.');
      return { lines };
    }
    case 'close': {
      const szi = positionSize(a.coin, t.mode);
      if (szi === 0) throw new Error(`No open ${a.coin} position`);
      lines.push(`Market close ${a.coin} ${szi > 0 ? 'long' : 'short'} ${Math.abs(szi)} (mid ${mid(a.coin)})`);
      return { lines };
    }
  }
}

const result = (r: LiveResult | TradeResult): TradeResult => ({ ok: r.ok, message: r.message });

/** Cancel the order a proposal replaces, after the new one was accepted. */
async function cancelReplaced(coin: string, mode: 'paper' | 'live', oid: OrderId | undefined, first: TradeResult): Promise<TradeResult> {
  if (oid === undefined || !first.ok) return first;
  if (mode === 'live') {
    const r = await cancelLiveOrders([{ coin, oid: Number(oid) }]);
    return { ok: r.ok, message: `${first.message} | cancel #${oid}: ${r.message}` };
  }
  const engine = getPaperEngine();
  // TP/SL linked to the replaced entry would otherwise outlive it.
  const children = useAccountStore.getState().paperOrders.filter(o => o.parentOid === String(oid)).map(o => o.id);
  const ok = engine?.cancelOrder(String(oid)) ?? false;
  for (const id of children) engine?.cancelOrder(id);
  const extra = children.length ? ` (and its TP/SL ${children.map(c => `#${c}`).join(', ')})` : '';
  return { ok, message: `${first.message} | cancel #${oid}: ${ok ? `cancelled${extra}` : 'not found'}` };
}

async function runLive(a: TradeAction, preview: TradePreview): Promise<TradeResult> {
  switch (a.kind) {
    case 'order':
      return cancelReplaced(a.coin, 'live', a.replaceOid, result(await submitPrepared(preview.prepared as PreparedOrder)));
    case 'tpsl':
      return cancelReplaced(a.coin, 'live', a.replaceOid, result(await placeLivePositionTrigger(a.coin, a.tpsl, a.price)));
    case 'cancel': {
      const targets = a.oids === 'all' ? ordersOn(a.coin, 'live') : a.oids.map(o => findTarget(a.coin, 'live', o));
      return result(await cancelLiveOrders(targets.map(o => ({ coin: a.coin, oid: Number(o.oid) }))));
    }
    case 'close':
      return result(await closeLivePosition(a.coin));
  }
}

async function paperOrder(a: OrderAction): Promise<TradeResult> {
  const engine = getPaperEngine();
  if (!engine) throw new Error('Paper engine is not running');
  const m = a.orderType === 'market' ? mid(a.coin) : null;
  const px = m ?? (a.price as number);
  const size = String(await paperSize(a.coin, resolveSize(a, px)));
  const r1 = engine.placeOrder({
    coin: a.coin, side: a.side, price: String(px), size, reduceOnly: !!a.reduceOnly,
    orderType: { limit: { tif: a.orderType === 'market' ? 'Ioc' : (a.tif ?? 'Gtc') } },
  });
  if (!r1.success) return { ok: false, message: r1.error ?? 'Order failed' };
  const closeSide: Side = a.side === 'buy' ? 'sell' : 'buy';
  const parts = [`placed #${r1.oid}`];
  // Same linkage as an executed setup: TP/SL wait for the entry to fill.
  for (const [tpsl, trig] of [['tp', a.tp], ['sl', a.sl]] as const) {
    if (trig === undefined) continue;
    const r = engine.placeOrder({
      coin: a.coin, side: closeSide, price: String(trig), size, reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: String(trig), tpsl } },
      parentOid: String(r1.oid),
    });
    parts.push(r.success ? `${tpsl.toUpperCase()} #${r.oid}` : `${tpsl.toUpperCase()} failed: ${r.error}`);
    if (!r.success) return { ok: false, message: parts.join(' | ') };
  }
  if (m !== null) engine.onPriceUpdate(a.coin, String(m));
  return { ok: true, message: parts.join(' | ') };
}

function paperTpsl(a: TpSlAction): TradeResult {
  const engine = getPaperEngine();
  if (!engine) throw new Error('Paper engine is not running');
  const szi = positionSize(a.coin, 'paper');
  const r = engine.placeOrder({
    coin: a.coin, side: szi > 0 ? 'sell' : 'buy', price: String(a.price), size: String(Math.abs(szi)), reduceOnly: true,
    orderType: { trigger: { isMarket: true, triggerPx: String(a.price), tpsl: a.tpsl } },
  });
  return r.success ? { ok: true, message: `${a.tpsl.toUpperCase()} #${r.oid} at ${a.price}` } : { ok: false, message: r.error ?? 'Order failed' };
}

async function runPaper(a: TradeAction): Promise<TradeResult> {
  const engine = getPaperEngine();
  if (!engine) throw new Error('Paper engine is not running');
  switch (a.kind) {
    case 'order':
      return cancelReplaced(a.coin, 'paper', a.replaceOid, await paperOrder(a));
    case 'tpsl':
      return cancelReplaced(a.coin, 'paper', a.replaceOid, paperTpsl(a));
    case 'cancel': {
      const targets = a.oids === 'all' ? ordersOn(a.coin, 'paper') : a.oids.map(o => findTarget(a.coin, 'paper', o));
      const missed = targets.filter(o => !engine.cancelOrder(String(o.oid)));
      return missed.length
        ? { ok: false, message: `not found: ${missed.map(o => `#${o.oid}`).join(', ')}` }
        : { ok: true, message: `Cancelled ${targets.length} order${targets.length === 1 ? '' : 's'}` };
    }
    case 'close': {
      const r = engine.marketClose(a.coin, String(mid(a.coin)));
      return r.success ? { ok: true, message: `closed ${r.filled?.totalSz} @ ${r.filled?.avgPx}` } : { ok: false, message: r.error ?? 'Close failed' };
    }
  }
}

/**
 * Run a proposal the user confirmed. Re-checks it against the account as it is
 * now (a market order gets a fresh worst price) before anything is sent.
 */
export async function executeTrade(t: TradeProposal): Promise<TradeResult> {
  try {
    const preview = await previewTrade(t);
    return t.mode === 'live' ? await runLive(t.action, preview) : await runPaper(t.action);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

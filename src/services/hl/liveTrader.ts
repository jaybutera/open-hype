import Decimal from 'decimal.js';
import { API_BASE } from '../../config/constants.ts';
import { IS_MAINNET, NETWORK } from './network.ts';
import { postInfo } from '../api/client.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useWalletStore, selectActiveAccount } from '../../store/useWalletStore.ts';
import { useLiveAccountStore, type LiveOpenOrder } from '../../store/useLiveAccountStore.ts';
import { buildAssetIndex, type AssetInfo } from './assets.ts';
import { formatPrice, formatSize } from './format.ts';
import { ExchangeClient, ExchangeError, isUnknownSignerError, type Grouping, type OrderStatus } from './exchange.ts';
import type { OrderWire, Side, TIF, TpSl } from '../../types/order.ts';

/** Worst-price cap for market (IOC) orders, same default as the official SDK. */
export const MARKET_SLIPPAGE = 0.05;
/** Worst-price cap applied to market TP/SL once triggered. */
export const TRIGGER_SLIPPAGE = 0.1;
/** Exchange minimum order value for opening orders. */
export const MIN_ORDER_USD = 10;

export interface LiveOrderInput {
  coin: string;
  side: Side;
  /** Size in asset units. Rounded down to the asset's lot size. */
  size: Decimal.Value;
  kind: 'limit' | 'market';
  /** Required for limit orders. */
  price?: Decimal.Value;
  tif?: TIF;
  reduceOnly?: boolean;
  /** Optional bracket: reduce-only market TP/SL sent atomically with the entry. */
  tp?: Decimal.Value;
  sl?: Decimal.Value;
  leverage?: number;
}

export interface PreparedOrder {
  asset: AssetInfo;
  wires: OrderWire[];
  grouping: Grouping;
  leverage?: number;
  /** Sub-account the order was reviewed for (null = master). Sent as vaultAddress. */
  vaultAddress: string | null;
  summary: {
    coin: string; side: Side; size: string; price: string; notional: number; network: string; kind: string;
    /** Account label shown on the review card. */
    account: string;
  };
}

function accountLabel(sub: string | null): string {
  if (!sub) return 'Master account';
  const name = useWalletStore.getState().subAccounts.find(a => a.address === sub)?.name;
  const short = `${sub.slice(0, 6)}…${sub.slice(-4)}`;
  return name ? `Sub-account ${name} (${short})` : `Sub-account ${short}`;
}

export interface LiveResult { ok: boolean; message: string; statuses?: OrderStatus[] }

let perpDexsPromise: Promise<({ name: string } | null)[]> | null = null;
function perpDexs() {
  perpDexsPromise ??= postInfo<({ name: string } | null)[]>({ type: 'perpDexs' }).catch(e => { perpDexsPromise = null; throw e; });
  return perpDexsPromise;
}

export async function resolveAsset(coin: string): Promise<AssetInfo> {
  const { meta, xyzMeta } = useMarketStore.getState();
  const index = buildAssetIndex(meta, [{ dex: 'xyz', meta: xyzMeta }], coin.includes(':') ? await perpDexs() : []);
  const a = index.get(coin);
  if (!a) throw new Error(`${coin} is not tradable on Hyperliquid ${NETWORK}`);
  if (a.isDelisted) throw new Error(`${coin} is delisted`);
  return a;
}

function mid(coin: string): Decimal {
  const m = useMarketStore.getState().allMids[coin];
  if (!m || !(parseFloat(m) > 0)) throw new Error(`No live price for ${coin}`);
  return new Decimal(m);
}

function triggerWire(asset: AssetInfo, closeIsBuy: boolean, triggerPx: Decimal.Value, size: string, tpsl: TpSl): OrderWire {
  const px = new Decimal(triggerPx);
  const limit = closeIsBuy ? px.mul(1 + TRIGGER_SLIPPAGE) : px.mul(1 - TRIGGER_SLIPPAGE);
  return {
    a: asset.assetId, b: closeIsBuy,
    p: formatPrice(limit, asset.szDecimals), s: size, r: true,
    t: { trigger: { isMarket: true, triggerPx: formatPrice(px, asset.szDecimals), tpsl } },
  };
}

/** Validate and build the exact wires that will be signed. Throws with a user-facing message. */
export async function prepareOrder(input: LiveOrderInput): Promise<PreparedOrder> {
  const asset = await resolveAsset(input.coin);
  const isBuy = input.side === 'buy';
  const size = formatSize(input.size, asset.szDecimals);
  if (new Decimal(size).lte(0)) throw new Error(`Size rounds to zero at ${asset.szDecimals} decimals`);

  let price: string;
  let tif: TIF;
  if (input.kind === 'market') {
    const m = mid(input.coin);
    price = formatPrice(isBuy ? m.mul(1 + MARKET_SLIPPAGE) : m.mul(1 - MARKET_SLIPPAGE), asset.szDecimals);
    tif = 'Ioc';
  } else {
    if (input.price == null || !(new Decimal(input.price).gt(0))) throw new Error('Limit price required');
    price = formatPrice(input.price, asset.szDecimals);
    tif = input.tif ?? 'Gtc';
  }

  const refPx = input.kind === 'market' ? mid(input.coin) : new Decimal(price);
  const notional = refPx.mul(size).toNumber();
  if (!input.reduceOnly && notional < MIN_ORDER_USD) {
    throw new Error(`Order value $${notional.toFixed(2)} is below Hyperliquid's $${MIN_ORDER_USD} minimum`);
  }

  for (const [label, px] of [['TP', input.tp], ['SL', input.sl]] as const) {
    if (px == null) continue;
    const d = new Decimal(px);
    const above = d.gt(refPx);
    const wantAbove = (label === 'TP') === isBuy;
    if (above !== wantAbove) {
      throw new Error(`${label} ${d.toString()} is on the wrong side of entry ${refPx.toString()} for a ${input.side}`);
    }
  }

  const wires: OrderWire[] = [{
    a: asset.assetId, b: isBuy, p: price, s: size, r: !!input.reduceOnly, t: { limit: { tif } },
  }];
  if (input.tp != null) wires.push(triggerWire(asset, !isBuy, input.tp, size, 'tp'));
  if (input.sl != null) wires.push(triggerWire(asset, !isBuy, input.sl, size, 'sl'));

  return {
    asset,
    wires,
    grouping: wires.length > 1 ? 'normalTpsl' : 'na',
    leverage: input.reduceOnly ? undefined : input.leverage,
    vaultAddress: vault(),
    summary: { coin: input.coin, side: input.side, size, price, notional, network: NETWORK, kind: input.kind, account: accountLabel(vault()) },
  };
}

let client: ExchangeClient | null = null;
function exchange(): ExchangeClient {
  const { agent, tradingStatus } = useWalletStore.getState();
  if (!agent || tradingStatus !== 'ready') throw new Error('Connect a wallet and enable trading first');
  if (client?.signerAddress !== agent.address) client = new ExchangeClient(agent, { apiBase: API_BASE, isMainnet: IS_MAINNET });
  return client;
}

/** Sub-account to act on (sent as vaultAddress), or null for the master account. */
function vault(): string | null {
  return useWalletStore.getState().subAccount;
}

function refreshAccount() {
  const user = selectActiveAccount(useWalletStore.getState());
  if (user) void useLiveAccountStore.getState().refresh(user);
}

/** Positions in the account store must belong to the account the action targets; load them if not. */
async function ensureSynced() {
  const want = selectActiveAccount(useWalletStore.getState());
  const store = useLiveAccountStore.getState();
  if (want && (store.user !== want || store.lastSync == null)) await store.refresh(want);
}

async function run(fn: () => Promise<LiveResult>): Promise<LiveResult> {
  try {
    return await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof ExchangeError && isUnknownSignerError(message)) {
      useWalletStore.getState().invalidateAgent(
        useWalletStore.getState().source === 'browser'
          ? 'Trading key is not approved for this account on Hyperliquid; enable trading again'
          : 'This API wallet is not approved for that account (or the account has no deposit)',
      );
    }
    return { ok: false, message };
  } finally {
    refreshAccount();
  }
}

function describeStatuses(statuses: OrderStatus[]): LiveResult {
  const parts = statuses.map(s => {
    switch (s.kind) {
      case 'resting': return `resting #${s.oid}`;
      case 'filled': return `filled ${s.totalSz} @ ${s.avgPx}`;
      case 'pending': return s.detail;
      case 'error': return `rejected: ${s.message}`;
    }
  });
  return { ok: statuses.length > 0 && statuses.every(s => s.kind !== 'error'), message: parts.join(' | ') || 'No status returned', statuses };
}

/** Leverage this session already set, keyed by signer, account and coin. */
const appliedLeverage = new Map<string, number>();

/** Align account leverage for the asset before an opening order. Skips when it already matches. */
async function ensureLeverage(asset: AssetInfo, leverage: number, vaultAddress: string | null) {
  const lev = Math.max(1, Math.min(Math.floor(leverage), asset.maxLeverage));
  const ex = exchange();
  const key = `${ex.signerAddress}:${vaultAddress ?? 'master'}:${asset.coin}`;
  const pos = useLiveAccountStore.getState().positions.find(p => p.coin === asset.coin);
  if (pos ? pos.leverage.value === lev : appliedLeverage.get(key) === lev) return;
  const isCross = pos ? pos.leverage.type === 'cross' : !asset.onlyIsolated;
  await ex.updateLeverage(asset.assetId, isCross, lev, vaultAddress);
  appliedLeverage.set(key, lev);
}

export function submitPrepared(p: PreparedOrder): Promise<LiveResult> {
  return run(async () => {
    const v = p.vaultAddress;
    if (v !== vault()) throw new Error('Account changed after review; review the order again');
    if (p.leverage) { await ensureSynced(); await ensureLeverage(p.asset, p.leverage, v); }
    return describeStatuses(await exchange().placeOrders(p.wires, p.grouping, v));
  });
}

export async function placeLiveOrder(input: LiveOrderInput): Promise<LiveResult> {
  let prepared: PreparedOrder;
  try { prepared = await prepareOrder(input); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
  return submitPrepared(prepared);
}

/** Reduce-only market TP or SL for the whole open position. */
export function placeLivePositionTrigger(coin: string, tpsl: TpSl, triggerPx: Decimal.Value): Promise<LiveResult> {
  return run(async () => {
    await ensureSynced();
    const v = vault();
    const pos = useLiveAccountStore.getState().positions.find(p => p.coin === coin);
    if (!pos) throw new Error(`No open ${coin} position`);
    const asset = await resolveAsset(coin);
    const wire = triggerWire(asset, pos.szi < 0, triggerPx, formatSize(Math.abs(pos.szi), asset.szDecimals), tpsl);
    return describeStatuses(await exchange().placeOrders([wire], 'na', v));
  });
}

export function closeLivePosition(coin: string): Promise<LiveResult> {
  return run(async () => {
    await ensureSynced();
    const v = vault();
    const pos = useLiveAccountStore.getState().positions.find(p => p.coin === coin);
    if (!pos) throw new Error(`No open ${coin} position`);
    const p = await prepareOrder({ coin, side: pos.szi > 0 ? 'sell' : 'buy', size: Math.abs(pos.szi), kind: 'market', reduceOnly: true });
    return describeStatuses(await exchange().placeOrders(p.wires, 'na', v));
  });
}

export function cancelLiveOrders(orders: { coin: string; oid: number }[]): Promise<LiveResult> {
  return run(async () => {
    if (!orders.length) return { ok: true, message: 'Nothing to cancel' };
    const v = vault();
    const cancels = await Promise.all(orders.map(async o => ({ a: (await resolveAsset(o.coin)).assetId, o: o.oid })));
    const res = await exchange().cancel(cancels, v);
    const failed = res.filter(r => !r.ok) as { ok: false; message: string }[];
    return failed.length
      ? { ok: false, message: failed.map(f => f.message).join(' | ') }
      : { ok: true, message: `Cancelled ${res.length} order${res.length === 1 ? '' : 's'}` };
  });
}

/** TP or SL kind from Hyperliquid's order type label ("Take Profit Market", "Stop Limit"...). */
export function triggerKind(orderType: string): TpSl | undefined {
  if (/take profit/i.test(orderType)) return 'tp';
  if (/stop/i.test(orderType)) return 'sl';
  return undefined;
}

/**
 * Build the batchModify wire that moves a live TP/SL trigger to `newTriggerPx`, keeping
 * its side, size, reduce-only flag and market/limit type. Throws with a user-facing message.
 */
export async function prepareTriggerMove(order: LiveOpenOrder, newTriggerPx: Decimal.Value): Promise<{ oid: number; order: OrderWire; triggerPx: string }> {
  const tpsl = triggerKind(order.orderType);
  if (!order.isTrigger || !tpsl) throw new Error(`Order #${order.oid} is not a TP/SL trigger`);
  const asset = await resolveAsset(order.coin);
  const px = new Decimal(newTriggerPx);
  if (!px.isFinite() || px.lte(0)) throw new Error(`Invalid trigger price ${newTriggerPx}`);
  const triggerPx = formatPrice(px, asset.szDecimals);

  // A trigger dropped through the current price would fire at once; refuse instead.
  const m = mid(order.coin);
  const closeIsBuy = order.side === 'buy';
  const wantAbove = (tpsl === 'tp') !== closeIsBuy;
  const t = new Decimal(triggerPx);
  if (wantAbove ? t.lte(m) : t.gte(m)) {
    throw new Error(`${tpsl.toUpperCase()} ${triggerPx} must be ${wantAbove ? 'above' : 'below'} the current price ${m.toString()}`);
  }

  const isMarket = /market/i.test(order.orderType);
  const limit = isMarket
    ? (closeIsBuy ? t.mul(1 + TRIGGER_SLIPPAGE) : t.mul(1 - TRIGGER_SLIPPAGE))
    // Limit triggers keep their offset from the trigger.
    : new Decimal(order.limitPx).plus(t.minus(order.triggerPx));
  if (limit.lte(0)) throw new Error(`Limit price for #${order.oid} would be ${limit.toString()}`);
  const sz = new Decimal(order.sz);
  return {
    oid: order.oid,
    triggerPx,
    order: {
      a: asset.assetId, b: closeIsBuy, p: formatPrice(limit, asset.szDecimals),
      s: sz.gt(0) ? formatSize(sz, asset.szDecimals) : '0', r: order.reduceOnly,
      t: { trigger: { isMarket, triggerPx, tpsl } },
    },
  };
}

/** Move a live TP/SL trigger order to a new trigger price in place (batchModify). */
export function modifyLiveTrigger(order: LiveOpenOrder, newTriggerPx: Decimal.Value): Promise<LiveResult> {
  return run(async () => {
    const m = await prepareTriggerMove(order, newTriggerPx);
    const statuses = await exchange().batchModify([{ oid: m.oid, order: m.order }], vault());
    // Request-level rejections throw; a bare `default` response with no statuses means it was accepted.
    const res = statuses.length ? describeStatuses(statuses) : { ok: true, message: '', statuses };
    return res.ok ? { ...res, message: `${triggerKind(order.orderType)!.toUpperCase()} moved to ${m.triggerPx}` } : res;
  });
}

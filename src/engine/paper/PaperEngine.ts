import Decimal from 'decimal.js';
import type { OrderRequest, PlaceOrderResult, Side } from '../../types/order.ts';
import { DEFAULT_LEVERAGE, MAINTENANCE_MARGIN_RATE, MAKER_FEE_RATE, TAKER_FEE_RATE } from '../../config/constants.ts';
import { matchOrders, matchTriggersByCandle, type PaperOrder, type FillResult } from './matching.ts';
import { applyFill, computeUnrealizedPnl, computeLiquidationPrice, type PaperPosition } from './positions.ts';
import { calculateFee } from './pnl.ts';
import { createLedgerEntry, createOptionLedgerEntry, resetLedgerIds, type LedgerEntry } from './ledger.ts';
import type { Leg, OptionContract } from '../../services/options/types.ts';
import {
  serializeOptionPosition,
  deserializeOptionPosition,
  type OptionPosition,
  type OptionPositionJSON,
} from './options/OptionPosition.ts';
import { computeOpenLegsCost, legCashDelta, legMarginRequired } from './options/margin.ts';
import { legFillPrice, type FillModel } from './options/pricing.ts';
import { CONTRACT_MULTIPLIER } from './options/OptionPosition.ts';
import { buildSettlementDraft, selectSettleableLegs } from './options/settlement.ts';

export interface PaperState {
  balance: string;
  positions: PaperPosition[];
  openOrders: PaperOrder[];
  fills: LedgerEntry[];
  optionPositions: OptionPositionJSON[];
}

export interface PaperEngineConfig {
  initialBalance?: string;
  leverage?: number;
  makerRate?: string;
  takerRate?: string;
  onUpdate?: (state: PaperState) => void;
  onRejection?: (reason: string, order: PaperOrder) => void;
}

/** Rehydrate Decimal fields from JSON-serialized account data */
function rehydratePositions(raw: any[]): PaperPosition[] {
  return raw.map(p => ({
    coin: p.coin,
    szi: new Decimal(p.szi),
    entryPx: new Decimal(p.entryPx),
    unrealizedPnl: new Decimal(p.unrealizedPnl),
    realizedPnl: new Decimal(p.realizedPnl),
    marginUsed: new Decimal(p.marginUsed),
  }));
}

function rehydrateOrders(raw: any[]): PaperOrder[] {
  return raw.map(o => ({
    id: o.id,
    coin: o.coin,
    side: o.side,
    price: new Decimal(o.price),
    size: new Decimal(o.size),
    reduceOnly: o.reduceOnly,
    type: o.type,
    timestamp: o.timestamp,
    ...(o.triggerPx != null ? { triggerPx: new Decimal(o.triggerPx) } : {}),
    ...(o.tpsl != null ? { tpsl: o.tpsl } : {}),
    ...(o.isMarket != null ? { isMarket: o.isMarket } : {}),
    ...(o.parentOid != null ? { parentOid: o.parentOid } : {}),
  }));
}

let orderCounter = 0;
let optionLegCounter = 0;
let spreadCounter = 0;

export class PaperEngine {
  private balance: Decimal;
  private positions: Map<string, PaperPosition> = new Map();
  private openOrders: PaperOrder[] = [];
  private fills: LedgerEntry[] = [];
  private optionPositions: Map<string, OptionPosition> = new Map();
  private leverage: number;
  private makerRate: string;
  private takerRate: string;
  private onUpdate: ((state: PaperState) => void) | null;
  private onRejection: ((reason: string, order: PaperOrder) => void) | null = null;

  constructor(config: PaperEngineConfig = {}) {
    this.balance = new Decimal(config.initialBalance ?? '10000');
    this.leverage = config.leverage ?? DEFAULT_LEVERAGE;
    this.makerRate = config.makerRate ?? MAKER_FEE_RATE;
    this.takerRate = config.takerRate ?? TAKER_FEE_RATE;
    this.onUpdate = config.onUpdate ?? null;
    this.onRejection = config.onRejection ?? null;
    orderCounter = 0;
    optionLegCounter = 0;
    spreadCounter = 0;
    resetLedgerIds();
  }

  /**
   * Load saved state from a persisted paper account.
   * Rehydrates Decimal fields from serialized JSON.
   */
  loadState(saved: {
    balance: string;
    positions: any[];
    openOrders: any[];
    fills: LedgerEntry[];
    optionPositions?: OptionPositionJSON[];
  }): void {
    this.balance = new Decimal(saved.balance);
    this.positions.clear();
    for (const p of rehydratePositions(saved.positions)) {
      this.positions.set(p.coin, p);
    }
    this.openOrders = rehydrateOrders(saved.openOrders);
    this.fills = [...saved.fills];
    this.optionPositions.clear();
    for (const raw of saved.optionPositions ?? []) {
      const op = deserializeOptionPosition(raw);
      this.optionPositions.set(op.id, op);
    }
    // Sync counters so new IDs don't collide with loaded ones
    const maxOrdNum = this.openOrders.reduce((max, o) => {
      const m = o.id.match(/paper-ord-(\d+)/);
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    orderCounter = maxOrdNum;
    const maxFillNum = this.fills.reduce((max, f) => {
      const m = f.id.match(/paper-(\d+)/);
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    resetLedgerIds(maxFillNum + 1);
    const maxLegNum = Array.from(this.optionPositions.values()).reduce((max, p) => {
      const m = p.id.match(/paper-opt-(\d+)/);
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    optionLegCounter = maxLegNum;
    const maxSpreadNum = Array.from(this.optionPositions.values()).reduce((max, p) => {
      const m = p.spreadId.match(/paper-spread-(\d+)/);
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    spreadCounter = maxSpreadNum;
    this.emitUpdate();
  }

  placeOrder(req: OrderRequest): PlaceOrderResult {
    const size = new Decimal(req.size);
    const price = new Decimal(req.price);

    if (size.lte(0)) return { success: false, error: 'Size must be positive' };
    if (price.lte(0)) return { success: false, error: 'Price must be positive' };

    // Check reduceOnly
    if (req.reduceOnly) {
      const pos = this.positions.get(req.coin);
      if (!pos || pos.szi.isZero()) {
        return { success: false, error: 'No position to reduce' };
      }
      // reduceOnly buy is only valid for short, sell for long
      if (req.side === 'buy' && pos.szi.gt(0)) {
        return { success: false, error: 'Cannot reduce: position is long' };
      }
      if (req.side === 'sell' && pos.szi.lt(0)) {
        return { success: false, error: 'Cannot reduce: position is short' };
      }
    }

    const isLimit = 'limit' in req.orderType;
    const isTrigger = 'trigger' in req.orderType;

    // Check margin at placement for non-reduceOnly orders
    if (!req.reduceOnly && !('trigger' in req.orderType && (req.orderType as any).trigger.tpsl)) {
      const requiredMargin = size.mul(price).div(this.leverage);
      const available = this.availableBalance();
      if (requiredMargin.gt(available)) {
        return { success: false, error: `Insufficient margin: need ${requiredMargin.toFixed(2)}, available ${available.toFixed(2)}` };
      }
    }

    const oid = `paper-ord-${++orderCounter}`;
    const order: PaperOrder = {
      id: oid,
      coin: req.coin,
      side: req.side,
      price,
      size,
      reduceOnly: req.reduceOnly,
      type: isLimit ? 'limit' : 'trigger',
      timestamp: Date.now(),
    };

    if (isTrigger) {
      const trig = (req.orderType as { trigger: { isMarket: boolean; triggerPx: string; tpsl: 'tp' | 'sl' } }).trigger;
      order.triggerPx = new Decimal(trig.triggerPx);
      order.tpsl = trig.tpsl;
      order.isMarket = trig.isMarket;
    }

    if (req.parentOid) {
      order.parentOid = req.parentOid;
    }

    this.openOrders.push(order);
    this.emitUpdate();

    return { success: true, oid };
  }

  cancelOrder(orderId: string): boolean {
    const idx = this.openOrders.findIndex(o => o.id === orderId);
    if (idx === -1) return false;
    this.openOrders.splice(idx, 1);
    this.emitUpdate();
    return true;
  }

  cancelAllOrders(coin?: string): void {
    if (coin) {
      this.openOrders = this.openOrders.filter(o => o.coin !== coin);
    } else {
      this.openOrders = [];
    }
    this.emitUpdate();
  }

  /**
   * Called on every price tick. Attempts to fill matching orders.
   */
  onPriceUpdate(coin: string, midPrice: string): void {
    const mid = new Decimal(midPrice);

    // Update unrealized PnL for existing position
    const pos = this.positions.get(coin);
    if (pos) {
      pos.unrealizedPnl = computeUnrealizedPnl(pos, mid);
    }

    // Try to fill orders for this coin
    const coinOrders = this.openOrders.filter(o => o.coin === coin);
    if (coinOrders.length === 0) {
      if (pos) this.emitUpdate();
      return;
    }

    const fillResults = matchOrders(coinOrders, mid, this.openOrders);
    if (fillResults.length === 0) {
      if (pos) this.emitUpdate();
      return;
    }

    for (const fill of fillResults) {
      this.executeFill(fill);
    }

    this.emitUpdate();
  }

  /**
   * Called on candle updates. Checks trigger orders against the candle
   * high/low to catch wicks that the mid price might miss.
   */
  onCandleUpdate(coin: string, high: string, low: string): void {
    const coinOrders = this.openOrders.filter(
      o => o.coin === coin && o.type === 'trigger',
    );
    if (coinOrders.length === 0) return;

    const h = new Decimal(high);
    const l = new Decimal(low);
    const fillResults = matchTriggersByCandle(coinOrders, h, l, this.openOrders);
    if (fillResults.length === 0) return;

    for (const fill of fillResults) {
      this.executeFill(fill);
    }
    this.emitUpdate();
  }

  private executeFill(fill: FillResult): void {
    const { order, fillPrice, isMaker } = fill;

    // Margin check at fill time for new positions (not reduceOnly, not TP/SL)
    if (!order.reduceOnly && !order.tpsl) {
      const requiredMargin = fill.fillSize.mul(fillPrice).div(this.leverage);
      // Available balance excluding THIS order's reserved margin (it's about to be removed)
      let usedMargin = new Decimal(0);
      for (const pos of this.positions.values()) {
        usedMargin = usedMargin.add(pos.marginUsed);
      }
      for (const o of this.openOrders) {
        if (!o.reduceOnly && !o.tpsl && o.id !== order.id) {
          usedMargin = usedMargin.add(o.size.mul(o.price).div(this.leverage));
        }
      }
      const available = this.balance.sub(usedMargin);
      if (requiredMargin.gt(available)) {
        this.removeOrder(order.id);
        // Also cancel linked TP/SL orders
        this.openOrders = this.openOrders.filter(o => o.parentOid !== order.id);
        if (this.onRejection) {
          this.onRejection(`Insufficient margin: need ${requiredMargin.toFixed(2)}, available ${available.toFixed(2)}`, order);
        }
        return;
      }
    }

    // Enforce reduceOnly and TP/SL — both require an existing position to close
    if (order.reduceOnly || order.tpsl) {
      const pos = this.positions.get(order.coin);
      if (!pos || pos.szi.isZero()) {
        this.removeOrder(order.id);
        return;
      }
      // Verify TP/SL is closing the right direction (sell closes long, buy closes short)
      if (order.tpsl) {
        if (order.side === 'sell' && pos.szi.lt(0)) { this.removeOrder(order.id); return; }
        if (order.side === 'buy' && pos.szi.gt(0)) { this.removeOrder(order.id); return; }
      }
      // Clamp size to position size
      const maxClose = pos.szi.abs();
      if (fill.fillSize.gt(maxClose)) {
        fill.fillSize = maxClose;
      }
    }

    const fee = calculateFee(fill.fillSize, fillPrice, isMaker, this.makerRate, this.takerRate);
    const existing = this.positions.get(order.coin) ?? null;

    const result = applyFill(
      existing,
      order.coin,
      order.side,
      fill.fillSize,
      fillPrice,
      this.leverage,
    );

    // Update balance: subtract fee, add realized PnL
    this.balance = this.balance.sub(fee).add(result.realizedPnl);

    // Update position
    if (result.position) {
      this.positions.set(order.coin, result.position);
    } else {
      this.positions.delete(order.coin);
      // Position fully closed — cancel all reduceOnly and TP/SL orders for this coin
      this.openOrders = this.openOrders.filter(
        o => !(o.coin === order.coin && (o.reduceOnly || o.tpsl) && o.id !== order.id)
      );
    }

    // Record fill
    this.fills.push(createLedgerEntry(
      order.coin,
      order.side,
      fill.fillSize,
      fillPrice,
      fee,
      result.realizedPnl,
      this.balance,
    ));

    // Remove the filled order
    this.removeOrder(order.id);
  }

  private removeOrder(orderId: string): void {
    this.openOrders = this.openOrders.filter(o => o.id !== orderId);
  }

  /**
   * Available balance for PERP margin checks. Hyperliquid only has perps —
   * options are a separate paper-trading sandbox in this app, so their
   * cash-secured reservations do not consume perp margin capacity.
   */
  private availableBalance(): Decimal {
    let totalMargin = new Decimal(0);
    for (const pos of this.positions.values()) {
      totalMargin = totalMargin.add(pos.marginUsed);
    }
    // Reserve margin for pending entry orders (non-reduceOnly, non-TP/SL)
    for (const o of this.openOrders) {
      if (!o.reduceOnly && !o.tpsl) {
        totalMargin = totalMargin.add(o.size.mul(o.price).div(this.leverage));
      }
    }
    return this.balance.sub(totalMargin);
  }

  /**
   * Available balance for OPTIONS cash-secured checks. Includes perp margin
   * usage so an account fully tied up in perps can't also write options.
   */
  private availableForOptions(): Decimal {
    let totalMargin = new Decimal(0);
    for (const pos of this.positions.values()) {
      totalMargin = totalMargin.add(pos.marginUsed);
    }
    for (const o of this.openOrders) {
      if (!o.reduceOnly && !o.tpsl) {
        totalMargin = totalMargin.add(o.size.mul(o.price).div(this.leverage));
      }
    }
    for (const op of this.optionPositions.values()) {
      totalMargin = totalMargin.add(op.marginUsed);
    }
    return this.balance.sub(totalMargin);
  }

  // Public getters

  getBalance(): string {
    return this.balance.toString();
  }

  getPositions(): PaperPosition[] {
    return Array.from(this.positions.values());
  }

  getOpenOrders(): PaperOrder[] {
    return [...this.openOrders];
  }

  getFills(): LedgerEntry[] {
    return [...this.fills];
  }

  getPosition(coin: string): PaperPosition | null {
    return this.positions.get(coin) ?? null;
  }

  /**
   * Market close a position at current mid price.
   */
  marketClose(coin: string, midPrice: string): PlaceOrderResult {
    const pos = this.positions.get(coin);
    if (!pos || pos.szi.isZero()) {
      return { success: false, error: 'No position to close' };
    }
    const side = pos.szi.gt(0) ? 'sell' : 'buy';
    const size = pos.szi.abs();
    const price = new Decimal(midPrice);
    const fee = calculateFee(size, price, false, this.makerRate, this.takerRate); // taker
    const existing = this.positions.get(coin)!;
    const result = applyFill(existing, coin, side, size, price, this.leverage);

    this.balance = this.balance.sub(fee).add(result.realizedPnl);
    if (result.position) {
      this.positions.set(coin, result.position);
    } else {
      this.positions.delete(coin);
    }

    // Cancel any reduceOnly orders for this coin since position is gone
    if (!result.position) {
      this.openOrders = this.openOrders.filter(o => !(o.coin === coin && o.reduceOnly));
    }

    this.fills.push(createLedgerEntry(coin, side, size, price, fee, result.realizedPnl, this.balance));
    this.emitUpdate();
    return { success: true, filled: { totalSz: size.toString(), avgPx: midPrice } };
  }

  getLiquidationPrice(coin: string): Decimal | null {
    const pos = this.positions.get(coin);
    if (!pos) return null;
    return computeLiquidationPrice(pos, this.balance, new Decimal(MAINTENANCE_MARGIN_RATE));
  }

  setLeverage(leverage: number): void {
    this.leverage = leverage;
  }

  setFeeRates(makerRate: string, takerRate: string): void {
    this.makerRate = makerRate;
    this.takerRate = takerRate;
  }

  getState(): PaperState {
    return {
      balance: this.balance.toString(),
      positions: this.getPositions(),
      openOrders: this.getOpenOrders(),
      fills: [...this.fills],
      optionPositions: this.getOptionPositions().map(serializeOptionPosition),
    };
  }

  getOptionPositions(): OptionPosition[] {
    return Array.from(this.optionPositions.values());
  }

  getOptionPosition(id: string): OptionPosition | null {
    return this.optionPositions.get(id) ?? null;
  }

  getOptionPositionsBySpread(spreadId: string): OptionPosition[] {
    return this.getOptionPositions().filter(p => p.spreadId === spreadId);
  }

  /**
   * Direct storage-only add; does NOT debit balance or run margin checks.
   * Kept for tests and raw rehydration. For live trade flow use
   * {@link openOptionLegs}.
   */
  addOptionPosition(p: OptionPosition): void {
    this.optionPositions.set(p.id, p);
    this.emitUpdate();
  }

  removeOptionPosition(id: string): boolean {
    const existed = this.optionPositions.delete(id);
    if (existed) this.emitUpdate();
    return existed;
  }

  /**
   * Open a set of option legs atomically as one spread. Prices each leg by
   * the chosen fill model, debits net premium (or credits for credit
   * spreads), reserves cash margin for short legs, and records one ledger
   * entry per leg tagged with the shared spreadId.
   *
   * Returns the new spreadId + created positions on success, or an error
   * string on rejection. Balance and positions are unchanged on failure.
   */
  openOptionLegs(
    legs: Leg[],
    opts: { fillModel?: FillModel; qtyScalar?: number } = {},
  ): { success: true; spreadId: string; positions: OptionPosition[] }
    | { success: false; error: string } {
    if (legs.length === 0) return { success: false, error: 'No legs to open' };
    if (legs.length > 4) return { success: false, error: 'Too many legs (max 4)' };
    const scalar = opts.qtyScalar ?? 1;
    if (!Number.isFinite(scalar) || scalar <= 0) {
      return { success: false, error: 'qtyScalar must be positive' };
    }
    const fillModel = opts.fillModel ?? 'mid';

    // Price each leg and build signed-size + entry Decimal pairs.
    const priced: Array<{
      leg: Leg;
      szi: Decimal;
      entryPx: Decimal;
    }> = [];
    for (const leg of legs) {
      if (!Number.isFinite(leg.qty) || leg.qty <= 0) {
        return { success: false, error: `Leg qty must be positive (${leg.contract.symbol})` };
      }
      const { price } = legFillPrice(leg.contract, leg.side, fillModel);
      if (price <= 0) {
        return { success: false, error: `No usable quote for ${leg.contract.symbol}` };
      }
      const signedQty = new Decimal(leg.qty).mul(scalar).mul(leg.side === 'buy' ? 1 : -1);
      priced.push({ leg, szi: signedQty, entryPx: new Decimal(price) });
    }

    const cost = computeOpenLegsCost(priced.map(p => ({ szi: p.szi, entryPx: p.entryPx })));
    const available = this.availableForOptions();
    if (cost.cashRequired.gt(available)) {
      return {
        success: false,
        error: `Insufficient balance: need ${cost.cashRequired.toFixed(2)}, available ${available.toFixed(2)}`,
      };
    }

    const spreadId = `paper-spread-${++spreadCounter}`;
    const openedAt = Date.now();
    const created: OptionPosition[] = [];
    for (const p of priced) {
      const id = `paper-opt-${++optionLegCounter}`;
      const marginUsed = legMarginRequired(p.szi, p.entryPx);
      const position: OptionPosition = {
        id,
        spreadId,
        contractSymbol: p.leg.contract.symbol,
        underlying: p.leg.contract.underlying,
        type: p.leg.contract.type,
        strike: new Decimal(p.leg.contract.strike),
        expiration: p.leg.contract.expiration,
        szi: p.szi,
        entryPx: p.entryPx,
        marginUsed,
        openedAt,
      };
      this.optionPositions.set(id, position);
      created.push(position);
    }

    // Debit net premium. A credit spread has netDebit < 0, so this ADDS to
    // the balance. Margin reservation is NOT subtracted here — it's reflected
    // via each leg's marginUsed, which availableBalance() now counts.
    this.balance = this.balance.sub(cost.netDebit);

    // Emit one ledger entry per leg so the PnL calendar and activity view
    // can render per-leg rows tagged with the shared spreadId.
    for (const p of priced) {
      const cashDelta = legCashDelta(p.szi, p.entryPx);
      this.fills.push(createOptionLedgerEntry({
        kind: 'option-open',
        contractSymbol: p.leg.contract.symbol,
        side: p.leg.side,
        qty: p.szi.abs(),
        premiumPerShare: p.entryPx,
        cashDelta,
        realizedPnl: new Decimal(0),
        balanceAfter: this.balance,
        spreadId,
      }));
    }

    this.emitUpdate();
    return { success: true, spreadId, positions: created };
  }

  /**
   * Close every leg of an open spread at once. Caller supplies the current
   * chain's contracts so the engine can price each leg; the engine looks up
   * each leg's contract by symbol. The close fill is the opposite side of
   * the leg (long → sell at bid/mid, short → buy at ask/mid).
   *
   * For each leg: realized PnL is `(closePx - entryPx) × szi × 100`, the
   * position is removed, its reserved margin is released, and the balance
   * is credited/debited by the close proceeds. One `option-close` ledger
   * entry is written per leg tagged with the shared spreadId.
   *
   * Fails atomically: if any leg lacks a matching contract or has no usable
   * quote, nothing is modified and an error is returned.
   */
  closeOptionSpread(
    spreadId: string,
    contracts: OptionContract[],
    opts: { fillModel?: FillModel } = {},
  ): { success: true; realizedPnl: Decimal; closedLegs: number }
    | { success: false; error: string } {
    const legs = this.getOptionPositionsBySpread(spreadId);
    if (legs.length === 0) {
      return { success: false, error: `No open spread ${spreadId}` };
    }
    const fillModel = opts.fillModel ?? 'mid';
    const bySymbol = new Map<string, OptionContract>();
    for (const c of contracts) bySymbol.set(c.symbol, c);

    // Price every leg first; bail out before touching state on any failure.
    const priced: Array<{ leg: OptionPosition; closePx: Decimal; closeSide: 'buy' | 'sell' }> = [];
    for (const leg of legs) {
      const contract = bySymbol.get(leg.contractSymbol);
      if (!contract) {
        return { success: false, error: `No contract in chain for ${leg.contractSymbol}` };
      }
      const closeSide: 'buy' | 'sell' = leg.szi.isPositive() ? 'sell' : 'buy';
      const { price } = legFillPrice(contract, closeSide, fillModel);
      if (price <= 0) {
        return { success: false, error: `No usable quote for ${leg.contractSymbol}` };
      }
      priced.push({ leg, closePx: new Decimal(price), closeSide });
    }

    let totalRealized = new Decimal(0);
    for (const { leg, closePx, closeSide } of priced) {
      // Per-leg realized PnL: long → (close - entry) × qty × 100,
      // short (szi < 0) → same formula (szi sign flips it correctly).
      const realized = closePx.sub(leg.entryPx).mul(leg.szi).mul(CONTRACT_MULTIPLIER);
      totalRealized = totalRealized.add(realized);

      // Cash delta at close: long selling to close → cash in (+szi × closePx × 100);
      // short buying to close → cash out (−|szi| × closePx × 100, i.e. szi × closePx × 100
      // with szi < 0). The same formula works for both because szi is signed.
      const cashDelta = leg.szi.mul(closePx).mul(CONTRACT_MULTIPLIER);
      this.balance = this.balance.add(cashDelta);

      this.optionPositions.delete(leg.id);

      this.fills.push(createOptionLedgerEntry({
        kind: 'option-close',
        contractSymbol: leg.contractSymbol,
        side: closeSide,
        qty: leg.szi.abs(),
        premiumPerShare: closePx,
        cashDelta,
        realizedPnl: realized,
        balanceAfter: this.balance,
        spreadId,
      }));
    }

    this.emitUpdate();
    return { success: true, realizedPnl: totalRealized, closedLegs: priced.length };
  }

  /**
   * Close a single option leg by id. Thin wrapper over closeOptionSpread's
   * per-leg logic — useful for expanded-view per-leg close actions. Leaves
   * any sibling legs from the same spread open.
   */
  closeOptionLegById(
    legId: string,
    contracts: OptionContract[],
    opts: { fillModel?: FillModel } = {},
  ): { success: true; realizedPnl: Decimal }
    | { success: false; error: string } {
    const leg = this.optionPositions.get(legId);
    if (!leg) return { success: false, error: `No open leg ${legId}` };
    const fillModel = opts.fillModel ?? 'mid';
    const contract = contracts.find((c) => c.symbol === leg.contractSymbol);
    if (!contract) {
      return { success: false, error: `No contract in chain for ${leg.contractSymbol}` };
    }
    const closeSide: 'buy' | 'sell' = leg.szi.isPositive() ? 'sell' : 'buy';
    const { price } = legFillPrice(contract, closeSide, fillModel);
    if (price <= 0) {
      return { success: false, error: `No usable quote for ${leg.contractSymbol}` };
    }
    const closePx = new Decimal(price);
    const realized = closePx.sub(leg.entryPx).mul(leg.szi).mul(CONTRACT_MULTIPLIER);
    const cashDelta = leg.szi.mul(closePx).mul(CONTRACT_MULTIPLIER);

    this.balance = this.balance.add(cashDelta);
    this.optionPositions.delete(leg.id);
    this.fills.push(createOptionLedgerEntry({
      kind: 'option-close',
      contractSymbol: leg.contractSymbol,
      side: closeSide,
      qty: leg.szi.abs(),
      premiumPerShare: closePx,
      cashDelta,
      realizedPnl: realized,
      balanceAfter: this.balance,
      spreadId: leg.spreadId,
    }));

    this.emitUpdate();
    return { success: true, realizedPnl: realized };
  }

  /**
   * Auto-exercise expired option positions. For every leg whose expiration
   * has passed and whose underlying has a known price in `prices`, settle it
   * at intrinsic value: ITM long → credit intrinsic; ITM short → debit
   * intrinsic; OTM → expires worthless (cash delta zero). The position is
   * deleted, margin releases implicitly, and one `option-expire` ledger
   * entry is written per leg.
   *
   * Legs for underlyings missing from `prices` stay open — caller can pass
   * an updated map on the next chain refresh.
   *
   * Idempotent: called with no settleable legs, mutates nothing and emits
   * no update.
   */
  settleExpired(
    prices: Map<string, Decimal>,
    nowSec: number = Math.floor(Date.now() / 1000),
  ): { settled: number; realizedPnl: Decimal; settledSpreadIds: string[] } {
    const settleable = selectSettleableLegs(this.getOptionPositions(), prices, nowSec);
    if (settleable.length === 0) {
      return { settled: 0, realizedPnl: new Decimal(0), settledSpreadIds: [] };
    }
    let totalRealized = new Decimal(0);
    const spreadIds = new Set<string>();
    for (const { leg, underlyingPrice } of settleable) {
      const draft = buildSettlementDraft(leg, underlyingPrice);
      this.balance = this.balance.add(draft.cashDelta);
      this.optionPositions.delete(leg.id);
      totalRealized = totalRealized.add(draft.realizedPnl);
      spreadIds.add(leg.spreadId);
      this.fills.push(createOptionLedgerEntry({
        kind: 'option-expire',
        contractSymbol: leg.contractSymbol,
        side: draft.closeSide,
        qty: leg.szi.abs(),
        premiumPerShare: draft.intrinsic,
        cashDelta: draft.cashDelta,
        realizedPnl: draft.realizedPnl,
        balanceAfter: this.balance,
        spreadId: leg.spreadId,
      }));
    }
    this.emitUpdate();
    return {
      settled: settleable.length,
      realizedPnl: totalRealized,
      settledSpreadIds: Array.from(spreadIds),
    };
  }

  private emitUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate(this.getState());
    }
  }
}

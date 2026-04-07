import Decimal from 'decimal.js';
import type { OrderRequest, PlaceOrderResult, Side } from '../../types/order.ts';
import { DEFAULT_LEVERAGE, MAINTENANCE_MARGIN_RATE, MAKER_FEE_RATE, TAKER_FEE_RATE } from '../../config/constants.ts';
import { matchOrders, matchTriggersByCandle, type PaperOrder, type FillResult } from './matching.ts';
import { applyFill, computeUnrealizedPnl, computeLiquidationPrice, type PaperPosition } from './positions.ts';
import { calculateFee } from './pnl.ts';
import { createLedgerEntry, resetLedgerIds, type LedgerEntry } from './ledger.ts';

export interface PaperState {
  balance: string;
  positions: PaperPosition[];
  openOrders: PaperOrder[];
  fills: LedgerEntry[];
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

export class PaperEngine {
  private balance: Decimal;
  private positions: Map<string, PaperPosition> = new Map();
  private openOrders: PaperOrder[] = [];
  private fills: LedgerEntry[] = [];
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
    resetLedgerIds();
  }

  /**
   * Load saved state from a persisted paper account.
   * Rehydrates Decimal fields from serialized JSON.
   */
  loadState(saved: { balance: string; positions: any[]; openOrders: any[]; fills: LedgerEntry[] }): void {
    this.balance = new Decimal(saved.balance);
    this.positions.clear();
    for (const p of rehydratePositions(saved.positions)) {
      this.positions.set(p.coin, p);
    }
    this.openOrders = rehydrateOrders(saved.openOrders);
    this.fills = [...saved.fills];
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

    // Margin is checked at fill time, not placement (matches real HL behavior)

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
    const { order, fillPrice, fillSize, isMaker } = fill;

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
      if (fillSize.gt(maxClose)) {
        fill.fillSize = maxClose;
      }
    }

    // Check margin at fill time for non-reduceOnly, non-TP/SL orders
    if (!order.reduceOnly && !order.tpsl) {
      const requiredMargin = fill.fillSize.mul(fillPrice).div(this.leverage);
      const available = this.availableBalance();
      if (requiredMargin.gt(available)) {
        const reason = `Insufficient margin: need ${requiredMargin.toFixed(2)}, available ${available.toFixed(2)}`;
        console.warn(`[PaperEngine] Order ${order.id} rejected: ${reason}`);
        this.onRejection?.(reason, order);
        this.removeOrder(order.id);
        return;
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

  private availableBalance(): Decimal {
    let totalMargin = new Decimal(0);
    for (const pos of this.positions.values()) {
      totalMargin = totalMargin.add(pos.marginUsed);
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
    };
  }

  private emitUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate(this.getState());
    }
  }
}

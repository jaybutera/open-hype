import Decimal from 'decimal.js';
import type { Side, TpSl } from '../../types/order.ts';

export interface PaperOrder {
  id: string;
  coin: string;
  side: Side;
  price: Decimal;
  size: Decimal;
  reduceOnly: boolean;
  type: 'limit' | 'trigger';
  triggerPx?: Decimal;
  tpsl?: TpSl;
  isMarket?: boolean;
  timestamp: number;
  /** If set, this order only activates after the parent order has filled. */
  parentOid?: string;
}

export interface FillResult {
  order: PaperOrder;
  fillPrice: Decimal;
  fillSize: Decimal;
  isMaker: boolean;
}

/**
 * Check if a limit order should fill given the current price.
 */
export function shouldFillLimit(order: PaperOrder, midPrice: Decimal): boolean {
  if (order.type !== 'limit') return false;
  if (order.side === 'buy') return midPrice.lte(order.price);
  return midPrice.gte(order.price);
}

/**
 * Check if a trigger (stop/TP) order should activate given the current price.
 */
export function shouldTrigger(order: PaperOrder, midPrice: Decimal): boolean {
  if (order.type !== 'trigger' || !order.triggerPx) return false;

  if (order.tpsl === 'sl') {
    // Stop loss: long SL triggers when price drops, short SL triggers when price rises
    if (order.side === 'sell') return midPrice.lte(order.triggerPx); // long SL
    return midPrice.gte(order.triggerPx); // short SL
  }
  if (order.tpsl === 'tp') {
    // Take profit: long TP triggers when price rises, short TP triggers when price drops
    if (order.side === 'sell') return midPrice.gte(order.triggerPx); // long TP
    return midPrice.lte(order.triggerPx); // short TP
  }
  return false;
}

/**
 * Check if a trigger order should activate given a candle's high and low.
 * This catches wicks that cross the trigger but where mid price may not.
 */
export function shouldTriggerFromCandle(
  order: PaperOrder,
  high: Decimal,
  low: Decimal,
): boolean {
  if (order.type !== 'trigger' || !order.triggerPx) return false;

  if (order.tpsl === 'sl') {
    if (order.side === 'sell') return low.lte(order.triggerPx);  // long SL
    return high.gte(order.triggerPx);  // short SL
  }
  if (order.tpsl === 'tp') {
    if (order.side === 'sell') return high.gte(order.triggerPx); // long TP
    return low.lte(order.triggerPx);  // short TP
  }
  return false;
}

/**
 * Match trigger orders against candle high/low.
 * Fills at the trigger price (the order would have been hit at that exact level).
 */
export function matchTriggersByCandle(
  orders: PaperOrder[],
  high: Decimal,
  low: Decimal,
  allOpenOrders?: PaperOrder[],
): FillResult[] {
  const fills: FillResult[] = [];

  for (const order of orders) {
    if (order.type !== 'trigger') continue;
    // Skip orders whose parent entry hasn't filled yet
    if (order.parentOid && allOpenOrders) {
      if (allOpenOrders.some(o => o.id === order.parentOid)) continue;
    }
    if (!shouldTriggerFromCandle(order, high, low)) continue;

    fills.push({
      order,
      fillPrice: order.triggerPx!,  // fill at trigger price
      fillSize: order.size,
      isMaker: false,
    });
  }

  return fills;
}

/**
 * Attempt to fill orders against a new price tick.
 * Returns orders that should be filled this tick.
 */
export function matchOrders(orders: PaperOrder[], midPrice: Decimal, allOpenOrders?: PaperOrder[]): FillResult[] {
  const fills: FillResult[] = [];
  // Track parent orders filled in this batch so children can activate
  const filledParentIds = new Set<string>();

  for (const order of orders) {
    // Skip orders whose parent entry hasn't filled yet
    if (order.parentOid && allOpenOrders) {
      const parentStillOpen = allOpenOrders.some(o => o.id === order.parentOid);
      if (parentStillOpen && !filledParentIds.has(order.parentOid)) continue;
    }

    if (order.type === 'limit') {
      if (shouldFillLimit(order, midPrice)) {
        filledParentIds.add(order.id);
        fills.push({
          order,
          fillPrice: order.price,  // fill at limit price (maker)
          fillSize: order.size,
          isMaker: true,
        });
      }
    } else if (order.type === 'trigger') {
      if (shouldTrigger(order, midPrice)) {
        if (order.isMarket) {
          fills.push({
            order,
            fillPrice: midPrice,  // fill at market (taker)
            fillSize: order.size,
            isMaker: false,
          });
        } else {
          // Convert to limit — fill at the limit price if price is already past it
          fills.push({
            order,
            fillPrice: order.price,
            fillSize: order.size,
            isMaker: true,
          });
        }
      }
    }
  }

  return fills;
}

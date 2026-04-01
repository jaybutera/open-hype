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
 * Attempt to fill orders against a new price tick.
 * Returns orders that should be filled this tick.
 */
export function matchOrders(orders: PaperOrder[], midPrice: Decimal): FillResult[] {
  const fills: FillResult[] = [];

  for (const order of orders) {
    if (order.type === 'limit') {
      if (shouldFillLimit(order, midPrice)) {
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

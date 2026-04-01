import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { shouldFillLimit, shouldTrigger, matchOrders, type PaperOrder } from '../matching.ts';

function makeOrder(overrides: Partial<PaperOrder> = {}): PaperOrder {
  return {
    id: 'test-1',
    coin: 'BTC',
    side: 'buy',
    price: new Decimal('50000'),
    size: new Decimal('0.1'),
    reduceOnly: false,
    type: 'limit',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('shouldFillLimit', () => {
  it('fills buy limit when price drops to limit', () => {
    const order = makeOrder({ side: 'buy', price: new Decimal('50000') });
    expect(shouldFillLimit(order, new Decimal('50000'))).toBe(true);
    expect(shouldFillLimit(order, new Decimal('49999'))).toBe(true);
  });

  it('does not fill buy limit when price is above limit', () => {
    const order = makeOrder({ side: 'buy', price: new Decimal('50000') });
    expect(shouldFillLimit(order, new Decimal('50001'))).toBe(false);
  });

  it('fills sell limit when price rises to limit', () => {
    const order = makeOrder({ side: 'sell', price: new Decimal('55000') });
    expect(shouldFillLimit(order, new Decimal('55000'))).toBe(true);
    expect(shouldFillLimit(order, new Decimal('55001'))).toBe(true);
  });

  it('does not fill sell limit when price is below limit', () => {
    const order = makeOrder({ side: 'sell', price: new Decimal('55000') });
    expect(shouldFillLimit(order, new Decimal('54999'))).toBe(false);
  });

  it('ignores trigger orders', () => {
    const order = makeOrder({ type: 'trigger' });
    expect(shouldFillLimit(order, new Decimal('0'))).toBe(false);
  });
});

describe('shouldTrigger', () => {
  it('triggers long stop loss when price drops', () => {
    const order = makeOrder({
      type: 'trigger',
      side: 'sell',
      tpsl: 'sl',
      triggerPx: new Decimal('48000'),
    });
    expect(shouldTrigger(order, new Decimal('48000'))).toBe(true);
    expect(shouldTrigger(order, new Decimal('47000'))).toBe(true);
    expect(shouldTrigger(order, new Decimal('49000'))).toBe(false);
  });

  it('triggers long take profit when price rises', () => {
    const order = makeOrder({
      type: 'trigger',
      side: 'sell',
      tpsl: 'tp',
      triggerPx: new Decimal('55000'),
    });
    expect(shouldTrigger(order, new Decimal('55000'))).toBe(true);
    expect(shouldTrigger(order, new Decimal('56000'))).toBe(true);
    expect(shouldTrigger(order, new Decimal('54000'))).toBe(false);
  });

  it('triggers short stop loss when price rises', () => {
    const order = makeOrder({
      type: 'trigger',
      side: 'buy',
      tpsl: 'sl',
      triggerPx: new Decimal('52000'),
    });
    expect(shouldTrigger(order, new Decimal('52000'))).toBe(true);
    expect(shouldTrigger(order, new Decimal('53000'))).toBe(true);
    expect(shouldTrigger(order, new Decimal('51000'))).toBe(false);
  });

  it('triggers short take profit when price drops', () => {
    const order = makeOrder({
      type: 'trigger',
      side: 'buy',
      tpsl: 'tp',
      triggerPx: new Decimal('45000'),
    });
    expect(shouldTrigger(order, new Decimal('45000'))).toBe(true);
    expect(shouldTrigger(order, new Decimal('44000'))).toBe(true);
    expect(shouldTrigger(order, new Decimal('46000'))).toBe(false);
  });

  it('ignores limit orders', () => {
    const order = makeOrder({ type: 'limit', tpsl: 'sl', triggerPx: new Decimal('0') });
    expect(shouldTrigger(order, new Decimal('0'))).toBe(false);
  });
});

describe('matchOrders', () => {
  it('returns fills for eligible limit orders only', () => {
    const orders = [
      makeOrder({ id: 'a', side: 'buy', price: new Decimal('48000') }),
      makeOrder({ id: 'b', side: 'buy', price: new Decimal('49000') }),
    ];
    // Price 48500: only 'b' fills (48500 <= 49000), 'a' does not (48500 > 48000)
    const fills = matchOrders(orders, new Decimal('48500'));
    expect(fills).toHaveLength(1);
    expect(fills[0].order.id).toBe('b');
  });

  it('fills trigger as market when isMarket=true', () => {
    const order = makeOrder({
      type: 'trigger',
      side: 'sell',
      tpsl: 'sl',
      triggerPx: new Decimal('48000'),
      isMarket: true,
      price: new Decimal('47500'),
    });
    const fills = matchOrders([order], new Decimal('47000'));
    expect(fills).toHaveLength(1);
    expect(fills[0].fillPrice.toString()).toBe('47000'); // market price
    expect(fills[0].isMaker).toBe(false);
  });

  it('fills trigger at limit price when isMarket=false', () => {
    const order = makeOrder({
      type: 'trigger',
      side: 'sell',
      tpsl: 'sl',
      triggerPx: new Decimal('48000'),
      isMarket: false,
      price: new Decimal('47500'),
    });
    const fills = matchOrders([order], new Decimal('47000'));
    expect(fills).toHaveLength(1);
    expect(fills[0].fillPrice.toString()).toBe('47500'); // limit price
    expect(fills[0].isMaker).toBe(true);
  });

  it('returns empty for no matches', () => {
    const orders = [makeOrder({ side: 'buy', price: new Decimal('40000') })];
    const fills = matchOrders(orders, new Decimal('50000'));
    expect(fills).toHaveLength(0);
  });

  it('matches multiple orders in same tick', () => {
    const orders = [
      makeOrder({ id: 'a', side: 'buy', price: new Decimal('50000') }),
      makeOrder({ id: 'b', side: 'buy', price: new Decimal('51000') }),
    ];
    const fills = matchOrders(orders, new Decimal('49000'));
    expect(fills).toHaveLength(2);
  });
});

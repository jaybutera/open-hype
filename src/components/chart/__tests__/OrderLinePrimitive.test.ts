import { describe, it, expect, vi } from 'vitest';
import { OrderLinePrimitive, liveLineOrders } from '../OrderLinePrimitive.ts';
import type { LiveOpenOrder } from '../../../store/useLiveAccountStore.ts';

const base: LiveOpenOrder = {
  coin: 'BTC', oid: 1, side: 'sell', limitPx: '72786.0', sz: '0.40598', origSz: '0.40598', orderType: 'Stop Market',
  isTrigger: true, triggerPx: '80873.0', triggerCondition: 'Price below 80873', reduceOnly: true, isPositionTpsl: false, timestamp: 1,
};
const orders: LiveOpenOrder[] = [
  base,
  { ...base, oid: 2, orderType: 'Take Profit Market', triggerPx: '81019.0' },
  { ...base, oid: 3, orderType: 'Limit', isTrigger: false, triggerPx: '0.0', limitPx: '80000' },
  { ...base, oid: 4, coin: 'ETH' },
];

describe('live order lines', () => {
  it('maps this coin\'s TP/SL triggers at their trigger price and resting limits at their limit price', () => {
    const lines = liveLineOrders(orders, 'BTC');
    expect(lines.map(l => [l.id, l.tpsl, (l.triggerPx ?? l.price).toNumber()])).toEqual([
      ['live-1', 'sl', 80873], ['live-2', 'tp', 81019], ['live-3', undefined, 80000],
    ]);
  });

  it('a moved limit is drawn at the price it was sent to', () => {
    expect(liveLineOrders(orders, 'BTC', { 3: { px: 79500 } })[2].price.toNumber()).toBe(79500);
  });

  it('a moved trigger is drawn at the price it was sent to', () => {
    expect(liveLineOrders(orders, 'BTC', { 2: { px: 81100 } })[1].triggerPx?.toNumber()).toBe(81100);
  });

  it('dragging a live line reports its id and the dropped price', () => {
    const done = vi.fn();
    const prim = new OrderLinePrimitive(liveLineOrders(orders, 'BTC')[0], done);
    // Price 80873 sits at y=100 on this fake scale, 1 px per dollar.
    const series = { priceToCoordinate: (p: number) => 100 - (p - 80873), coordinateToPrice: (y: number) => 80873 - (y - 100) };
    prim.attached({ series, requestUpdate: () => {} } as never);
    expect(prim.handleMouseDown(10, 102)).toBe(true);
    prim.handleMouseMove(80850);
    expect(prim.displayPrice).toBe(80850);
    prim.handleMouseUp();
    expect(done).toHaveBeenCalledWith('live-1', 80850);
  });
});

/**
 * Integration test: wires PaperEngine to the real Zustand store
 * and verifies the store state (what the UI reads) matches engine state.
 * Engine behavior is tested in PaperEngine.test.ts — these tests focus on
 * the onUpdate callback and store propagation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PaperEngine } from '../PaperEngine.ts';
import { useAccountStore } from '../../../store/useAccountStore.ts';

function storeState() {
  const s = useAccountStore.getState();
  return {
    positions: s.paperPositions,
    orders: s.paperOrders,
    balance: s.paperBalance,
    fills: s.paperFills,
    lastRejection: s.lastRejection,
  };
}

describe('store integration', () => {
  let engine: PaperEngine;

  beforeEach(() => {
    useAccountStore.setState({
      paperBalance: '10000',
      paperPositions: [],
      paperOrders: [],
      paperFills: [],
      lastRejection: null,
    });

    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
      onUpdate: (state) => useAccountStore.getState().updatePaperState(state),
      onRejection: (reason) => useAccountStore.getState().setRejection(reason),
    });
  });

  it('store reflects position after fill', () => {
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '0.1',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });

    expect(storeState().orders).toHaveLength(1);
    expect(storeState().positions).toHaveLength(0);

    engine.onPriceUpdate('BTC', '50000');

    expect(storeState().positions).toHaveLength(1);
    expect(storeState().orders).toHaveLength(0);
    expect(storeState().fills).toHaveLength(1);
  });

  it('store is clean after TP triggers', () => {
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    engine.onPriceUpdate('BTC', '50000');

    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '55000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '55000', tpsl: 'tp' } },
    });
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '48000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '48000', tpsl: 'sl' } },
    });

    engine.onPriceUpdate('BTC', '55000');

    expect(storeState().positions).toHaveLength(0);
    expect(storeState().orders).toHaveLength(0);
  });

  it('continuous ticks after TP do not resurrect position', () => {
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    engine.onPriceUpdate('BTC', '50000');

    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '55000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '55000', tpsl: 'tp' } },
    });

    engine.onPriceUpdate('BTC', '55500');
    expect(storeState().positions).toHaveLength(0);

    for (let p = 55500; p <= 57000; p += 500) {
      engine.onPriceUpdate('BTC', p.toString());
      expect(storeState().positions).toHaveLength(0);
    }
  });

  describe('TP/SL attached to a resting entry survive the current position closing', () => {
    let entryOid: string;
    let tpOid: string;
    let slOid: string;

    beforeEach(() => {
      // Short 1 BTC at 50000 with a reduceOnly TP at 48000
      engine.placeOrder({
        coin: 'BTC', side: 'sell', price: '50000', size: '1',
        reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
      });
      engine.onPriceUpdate('BTC', '50000');
      engine.placeOrder({
        coin: 'BTC', side: 'buy', price: '48000', size: '1',
        reduceOnly: true,
        orderType: { trigger: { isMarket: true, triggerPx: '48000', tpsl: 'tp' } },
      });

      // Resting buy limit at 47000 with attached TP 52000 / SL 45000 (as propose_order places them)
      entryOid = engine.placeOrder({
        coin: 'BTC', side: 'buy', price: '47000', size: '1',
        reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
      }).oid as string;
      tpOid = engine.placeOrder({
        coin: 'BTC', side: 'sell', price: '52000', size: '1', reduceOnly: false,
        orderType: { trigger: { isMarket: true, triggerPx: '52000', tpsl: 'tp' } },
        parentOid: entryOid,
      }).oid as string;
      slOid = engine.placeOrder({
        coin: 'BTC', side: 'sell', price: '45000', size: '1', reduceOnly: false,
        orderType: { trigger: { isMarket: true, triggerPx: '45000', tpsl: 'sl' } },
        parentOid: entryOid,
      }).oid as string;
    });

    function expectEntryAndChildrenResting() {
      expect(storeState().positions).toHaveLength(0);
      const ids = engine.getOpenOrders().map(o => o.id).sort();
      expect(ids).toEqual([entryOid, tpOid, slOid].sort());
    }

    function fillEntryAndCheckProtection() {
      engine.onPriceUpdate('BTC', '47000');
      const pos = engine.getPosition('BTC');
      expect(pos?.szi.toString()).toBe('1');
      const orders = engine.getOpenOrders();
      expect(orders.map(o => o.id).sort()).toEqual([tpOid, slOid].sort());

      // SL is live for the long
      engine.onPriceUpdate('BTC', '45000');
      expect(engine.getPosition('BTC')).toBeNull();
      expect(storeState().orders).toHaveLength(0);
    }

    it('short closed by its TP fill', () => {
      engine.onPriceUpdate('BTC', '48000');
      expectEntryAndChildrenResting();
      fillEntryAndCheckProtection();
    });

    it('short closed by marketClose', () => {
      engine.marketClose('BTC', '49000');
      expectEntryAndChildrenResting();
      fillEntryAndCheckProtection();
    });
  });

  describe('cancelling an entry cancels its attached TP/SL', () => {
    function placeEntry(price: string, tp: string, sl: string) {
      const entry = engine.placeOrder({
        coin: 'BTC', side: 'buy', price, size: '0.1',
        reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
      }).oid as string;
      const tpOid = engine.placeOrder({
        coin: 'BTC', side: 'sell', price: tp, size: '0.1', reduceOnly: false,
        orderType: { trigger: { isMarket: true, triggerPx: tp, tpsl: 'tp' } },
        parentOid: entry,
      }).oid as string;
      const slOid = engine.placeOrder({
        coin: 'BTC', side: 'sell', price: sl, size: '0.1', reduceOnly: false,
        orderType: { trigger: { isMarket: true, triggerPx: sl, tpsl: 'sl' } },
        parentOid: entry,
      }).oid as string;
      return [entry, tpOid, slOid];
    }

    beforeEach(() => {
      engine.onPriceUpdate('BTC', '50000');
    });

    it('cancel by oid removes the entry, its TP and its SL', () => {
      const [entry] = placeEntry('49000', '51000', '48000');
      expect(engine.cancelOrder(entry)).toBe(true);
      expect(engine.getOpenOrders()).toHaveLength(0);
      expect(storeState().orders).toHaveLength(0);
    });

    it('cancelling one entry leaves another entry and its TP/SL untouched', () => {
      const [entryA] = placeEntry('49000', '51000', '48000');
      const keep = placeEntry('48500', '50500', '47500');
      engine.cancelOrder(entryA);
      expect(engine.getOpenOrders().map(o => o.id).sort()).toEqual([...keep].sort());
      expect(storeState().orders.map(o => o.id).sort()).toEqual([...keep].sort());
    });

    it('cancelAllOrders for the coin removes entries and children', () => {
      placeEntry('49000', '51000', '48000');
      placeEntry('48500', '50500', '47500');
      engine.cancelAllOrders('BTC');
      expect(engine.getOpenOrders()).toHaveLength(0);
    });
  });

  it('margin rejection at placement time', () => {
    // 100 BTC × 50000 / 10 = 500k margin
    const result = engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '100',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient margin');
    expect(engine.getOpenOrders()).toHaveLength(0);
  });
});

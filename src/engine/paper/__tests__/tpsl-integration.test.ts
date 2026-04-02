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

  it('margin rejection surfaces through store', () => {
    // 100 BTC × 50000 / 10 = 500k margin
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '100',
      reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
    });

    engine.onPriceUpdate('BTC', '50000');

    expect(storeState().positions).toHaveLength(0);
    expect(storeState().lastRejection).toContain('Insufficient margin');
  });
});

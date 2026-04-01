/**
 * Integration test: wires PaperEngine to the real Zustand store
 * and simulates continuous WebSocket price ticks, exactly as the app does.
 * Verifies the store state (what the UI reads) is correct after TP/SL fills.
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
  };
}

describe('TP/SL integration with Zustand store', () => {
  let engine: PaperEngine;

  beforeEach(() => {
    // Reset store
    useAccountStore.setState({
      paperBalance: '10000',
      paperPositions: [],
      paperOrders: [],
      paperFills: [],
    });

    // Wire engine → store exactly like useEngine.ts does
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
      onUpdate: (state) => {
        useAccountStore.getState().updatePaperState(state);
      },
    });
  });

  it('store shows no position/orders after TP triggers', () => {
    // Open position via market buy
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    engine.onPriceUpdate('BTC', '50000');

    expect(storeState().positions).toHaveLength(1);

    // Place TP and SL
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

    expect(storeState().orders).toHaveLength(2);

    // Simulate WS ticks approaching TP
    engine.onPriceUpdate('BTC', '52000');
    engine.onPriceUpdate('BTC', '53000');
    engine.onPriceUpdate('BTC', '54000');

    // Position and orders still there
    expect(storeState().positions).toHaveLength(1);
    expect(storeState().orders).toHaveLength(2);

    // TP triggers
    engine.onPriceUpdate('BTC', '55000');

    // Store should be clean
    expect(storeState().positions).toHaveLength(0);
    expect(storeState().orders).toHaveLength(0);
  });

  it('store shows no position/orders after SL triggers', () => {
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

    // SL triggers
    engine.onPriceUpdate('BTC', '47000');

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
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '48000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '48000', tpsl: 'sl' } },
    });

    // TP triggers
    engine.onPriceUpdate('BTC', '55500');
    expect(storeState().positions).toHaveLength(0);
    expect(storeState().orders).toHaveLength(0);

    // Simulate many more ticks after — state must stay clean
    for (let p = 55500; p <= 57000; p += 100) {
      engine.onPriceUpdate('BTC', p.toString());
      expect(storeState().positions).toHaveLength(0);
      expect(storeState().orders).toHaveLength(0);
    }
  });

  it('TP with USDC-derived fractional size via OrderPanel flow', () => {
    // Exact OrderPanel logic: usdcToAssetSize
    const sizeUsdc = '1000';
    const price = '50000';
    const assetSize = (parseFloat(sizeUsdc) / parseFloat(price)).toString();

    // Market order flow from OrderPanel.handleSubmit
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price, size: assetSize,
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    // OrderPanel calls onPriceUpdate immediately for market orders
    engine.onPriceUpdate('BTC', price);
    expect(storeState().positions).toHaveLength(1);

    const tpPrice = '55000';
    const slPrice = '48000';
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: tpPrice, size: assetSize,
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: tpPrice, tpsl: 'tp' } },
    });
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: slPrice, size: assetSize,
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: slPrice, tpsl: 'sl' } },
    });
    expect(storeState().orders).toHaveLength(2);

    // Simulate gradual price approach then cross TP
    for (let p = 50000; p <= 56000; p += 500) {
      engine.onPriceUpdate('BTC', p.toString());
    }

    expect(storeState().positions).toHaveLength(0);
    expect(storeState().orders).toHaveLength(0);
  });

  it('TP/SL placed from PositionTable TpSlInput after position exists', () => {
    // Position already open
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '0.5',
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    engine.onPriceUpdate('BTC', '50000');

    // TP/SL placed later from PositionTable (different sizes possible?
    // No — TpSlInput uses position.szi.abs().toString() for size)
    const pos = storeState().positions[0];
    const size = pos.szi.abs().toString();

    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '55000', size,
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '55000', tpsl: 'tp' } },
    });
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '48000', size,
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '48000', tpsl: 'sl' } },
    });

    // Price crosses TP
    engine.onPriceUpdate('BTC', '56000');

    expect(storeState().positions).toHaveLength(0);
    expect(storeState().orders).toHaveLength(0);
  });

  it('short position: TP below, SL above — TP fills', () => {
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    engine.onPriceUpdate('BTC', '50000');

    // Short TP: buy when price drops
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '45000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '45000', tpsl: 'tp' } },
    });
    // Short SL: buy when price rises
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '52000', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '52000', tpsl: 'sl' } },
    });

    engine.onPriceUpdate('BTC', '44000');

    expect(storeState().positions).toHaveLength(0);
    expect(storeState().orders).toHaveLength(0);
  });

  it('store reflects correct state when TP placed via chart shift-click', () => {
    // Position open
    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: '50000', size: '1',
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    engine.onPriceUpdate('BTC', '50000');

    // Chart shift-click places TP at a specific price
    // Uses the same placeOrder path
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '53500', size: '1',
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: '53500', tpsl: 'tp' } },
    });

    // No SL set — just TP
    expect(storeState().orders).toHaveLength(1);

    engine.onPriceUpdate('BTC', '54000');

    expect(storeState().positions).toHaveLength(0);
    expect(storeState().orders).toHaveLength(0);
  });

  it('BUG REPRO: chart-placed TP with size derived from TP price leaves residual position', () => {
    // Open long: $1000 USDC at BTC $50000 → size = 0.02
    const entryPrice = 50000;
    const sizeUsdc = 1000;
    const positionSize = sizeUsdc / entryPrice; // 0.02

    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: entryPrice.toString(), size: positionSize.toString(),
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    engine.onPriceUpdate('BTC', entryPrice.toString());
    expect(storeState().positions).toHaveLength(1);
    expect(storeState().positions[0].szi.toString()).toBe('0.02');

    // OLD BUG: Chart shift-click TP at $55000 calculated size as sizeUsdc/tpPrice
    // instead of using the position size. This creates a TP that only partially closes.
    const tpPrice = 55000;
    const buggyTpSize = sizeUsdc / tpPrice; // 0.01818... != 0.02

    // Place TP with the WRONG (undersized) size
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: tpPrice.toString(), size: buggyTpSize.toString(),
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: tpPrice.toString(), tpsl: 'tp' } },
    });
    // Place SL with the same buggy size
    const slPrice = 48000;
    const buggySlSize = sizeUsdc / slPrice;
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: slPrice.toString(), size: buggySlSize.toString(),
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: slPrice.toString(), tpsl: 'sl' } },
    });

    // TP triggers
    engine.onPriceUpdate('BTC', '56000');

    // With the buggy size, TP only closes 0.01818 of 0.02 → residual position remains
    // Position stays open, SL stays open — THIS IS THE BUG
    expect(storeState().positions).toHaveLength(1); // residual ~0.00182
    expect(storeState().orders).toHaveLength(1);    // SL still there
    expect(storeState().orders[0].tpsl).toBe('sl');
  });

  it('FIX: chart-placed TP with position size fully closes', () => {
    const entryPrice = 50000;
    const sizeUsdc = 1000;
    const positionSize = sizeUsdc / entryPrice; // 0.02

    engine.placeOrder({
      coin: 'BTC', side: 'buy', price: entryPrice.toString(), size: positionSize.toString(),
      reduceOnly: false, orderType: { limit: { tif: 'Ioc' } },
    });
    engine.onPriceUpdate('BTC', entryPrice.toString());
    expect(storeState().positions[0].szi.toString()).toBe('0.02');

    // FIX: use position size for TP/SL, not sizeUsdc / tpPrice
    const tpPrice = 55000;
    const slPrice = 48000;
    const correctSize = positionSize.toString(); // 0.02

    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: tpPrice.toString(), size: correctSize,
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: tpPrice.toString(), tpsl: 'tp' } },
    });
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: slPrice.toString(), size: correctSize,
      reduceOnly: true,
      orderType: { trigger: { isMarket: true, triggerPx: slPrice.toString(), tpsl: 'sl' } },
    });

    // TP triggers — position fully closes, SL cancelled
    engine.onPriceUpdate('BTC', '56000');

    expect(storeState().positions).toHaveLength(0);
    expect(storeState().orders).toHaveLength(0);
  });
});

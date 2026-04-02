import { describe, it, expect, beforeEach } from 'vitest';
import { PaperEngine } from '../PaperEngine.ts';
import { useTradeSetupStore } from '../../../store/useTradeSetupStore.ts';
import { useSettingsStore } from '../../../store/useSettingsStore.ts';
import { useMarketStore } from '../../../store/useMarketStore.ts';
import type { Side } from '../../../types/order.ts';

describe('trade setup execute flow', () => {
  let engine: PaperEngine;

  beforeEach(() => {
    engine = new PaperEngine({ initialBalance: '10000', leverage: 10 });
    // Reset stores
    useTradeSetupStore.setState({ activeSetups: [], pendingSetup: null });
    useSettingsStore.setState({ riskUsdc: '20' });
  });

  it('creates setup with correct size from risk', () => {
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000); // will be SL (lowest)
    store.addClick(50000); // will be entry (middle)
    const setup = store.addClick(54000); // will be TP (highest)

    expect(setup).not.toBeNull();
    expect(setup!.side).toBe('buy');
    expect(setup!.entryPrice).toBe(50000);
    expect(setup!.slPrice).toBe(48000);
    expect(setup!.tpPrice).toBe(54000);
    // riskUsdc=20, |entry-sl|=2000, assetSize = 20/2000 = 0.01
    expect(setup!.assetSize).toBe(0.01);
    expect(setup!.riskUsdc).toBe(20);
    // potentialPnl = 0.01 * |54000-50000| = 0.01 * 4000 = 40
    expect(setup!.potentialPnl).toBe(40);
    expect(setup!.rr).toBe(2); // 4000/2000
  });

  it('execute places entry + TP + SL orders', () => {
    useSettingsStore.setState({ riskUsdc: '20' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    const setup = store.addClick(54000)!;

    // Simulate what executeSetup in TradingChart does
    const sizeStr = setup.assetSize.toString();
    const closeSide = setup.side === 'buy' ? 'sell' as const : 'buy' as const;

    const r1 = engine.placeOrder({
      coin: 'BTC',
      side: setup.side,
      price: setup.entryPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { limit: { tif: 'Gtc' } },
    });
    expect(r1.success).toBe(true);

    // TP/SL are not reduceOnly since entry limit hasn't filled yet
    const r2 = engine.placeOrder({
      coin: 'BTC',
      side: closeSide,
      price: setup.tpPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: setup.tpPrice.toFixed(2), tpsl: 'tp' } },
    });
    expect(r2.success).toBe(true);

    const r3 = engine.placeOrder({
      coin: 'BTC',
      side: closeSide,
      price: setup.slPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: setup.slPrice.toFixed(2), tpsl: 'sl' } },
    });
    expect(r3.success).toBe(true);

    expect(engine.getOpenOrders()).toHaveLength(3);
  });

  it('fails with zero risk', () => {
    useSettingsStore.setState({ riskUsdc: '' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    const setup = store.addClick(54000)!;

    expect(setup.assetSize).toBe(0);
    expect(setup.riskUsdc).toBe(0);

    const r1 = engine.placeOrder({
      coin: 'BTC',
      side: setup.side,
      price: setup.entryPrice.toFixed(2),
      size: setup.assetSize.toString(),
      reduceOnly: false,
      orderType: { limit: { tif: 'Gtc' } },
    });
    expect(r1.success).toBe(false); // Size must be positive
  });

  it('executeSetupRef pattern works end-to-end', () => {
    // This replicates exactly what TradingChart.tsx does
    useSettingsStore.setState({ riskUsdc: '20' });
    useMarketStore.setState({ currentAsset: 'BTC' });

    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    store.addClick(54000);

    const activeSetups = useTradeSetupStore.getState().activeSetups;
    expect(activeSetups).toHaveLength(1);
    const setupId = activeSetups[0].id;

    // This is exactly what executeSetupRef.current does in TradingChart
    const setup = useTradeSetupStore.getState().activeSetups.find(s => s.id === setupId);
    expect(setup).toBeDefined();

    const sizeStr = setup!.assetSize.toString();
    expect(parseFloat(sizeStr)).toBeGreaterThan(0);

    const closeSide: Side = setup!.side === 'buy' ? 'sell' : 'buy';
    const asset = useMarketStore.getState().currentAsset;
    expect(asset).toBe('BTC');

    const r1 = engine.placeOrder({
      coin: asset,
      side: setup!.side,
      price: setup!.entryPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { limit: { tif: 'Gtc' } },
    });
    expect(r1.success).toBe(true);

    const r2 = engine.placeOrder({
      coin: asset,
      side: closeSide,
      price: setup!.tpPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: setup!.tpPrice.toFixed(2), tpsl: 'tp' } },
    });
    expect(r2.success).toBe(true);

    const r3 = engine.placeOrder({
      coin: asset,
      side: closeSide,
      price: setup!.slPrice.toFixed(2),
      size: sizeStr,
      reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: setup!.slPrice.toFixed(2), tpsl: 'sl' } },
    });
    expect(r3.success).toBe(true);

    expect(engine.getOpenOrders()).toHaveLength(3);
    const orders = engine.getOpenOrders();
    expect(orders.find(o => o.type === 'limit')).toBeDefined();
    expect(orders.find(o => o.tpsl === 'tp')).toBeDefined();
    expect(orders.find(o => o.tpsl === 'sl')).toBeDefined();

    // Now remove setup (as executeSetup does at the end)
    useTradeSetupStore.getState().removeSetup(setupId);
    expect(useTradeSetupStore.getState().activeSetups).toHaveLength(0);

    // Orders should still be there
    expect(engine.getOpenOrders()).toHaveLength(3);
  });

  it('short setup sorts prices correctly', () => {
    useSettingsStore.setState({ riskUsdc: '10' });
    const store = useTradeSetupStore.getState();
    store.startSetup('sell');
    store.addClick(50000); // will be entry (middle)
    store.addClick(52000); // will be SL (highest for short)
    const setup = store.addClick(46000)!; // will be TP (lowest for short)

    expect(setup.entryPrice).toBe(50000);
    expect(setup.slPrice).toBe(52000);
    expect(setup.tpPrice).toBe(46000);
    // risk=10, |entry-sl|=2000, assetSize = 10/2000 = 0.005
    expect(setup.assetSize).toBe(0.005);
  });
});

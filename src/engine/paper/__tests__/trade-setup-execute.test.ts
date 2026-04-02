import { describe, it, expect, beforeEach } from 'vitest';
import { PaperEngine } from '../PaperEngine.ts';
import { useTradeSetupStore } from '../../../store/useTradeSetupStore.ts';
import { useSettingsStore } from '../../../store/useSettingsStore.ts';
import type { Side } from '../../../types/order.ts';

/**
 * Replicates the exact flow from OrderPanel.handleExecuteSetup:
 * reads risk from settings, computes size, places entry + TP + SL.
 */
function executeSetup(engine: PaperEngine, setupId: string, coin: string) {
  const setup = useTradeSetupStore.getState().activeSetups.find(s => s.id === setupId);
  if (!setup) throw new Error('Setup not found');

  const currentRisk = parseFloat(useSettingsStore.getState().riskUsdc) || 0;
  const riskPerUnit = Math.abs(setup.entryPrice - setup.slPrice);
  const assetSize = riskPerUnit > 0 && currentRisk > 0
    ? currentRisk / riskPerUnit
    : setup.assetSize;
  const sizeStr = assetSize.toString();

  if (assetSize <= 0) throw new Error('Size is zero');

  const closeSide: Side = setup.side === 'buy' ? 'sell' : 'buy';

  const r1 = engine.placeOrder({
    coin, side: setup.side, price: setup.entryPrice.toFixed(2), size: sizeStr,
    reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
  });
  if (!r1.success) throw new Error(`Entry: ${r1.error}`);

  engine.placeOrder({
    coin, side: closeSide, price: setup.tpPrice.toFixed(2), size: sizeStr,
    reduceOnly: false,
    orderType: { trigger: { isMarket: true, triggerPx: setup.tpPrice.toFixed(2), tpsl: 'tp' } },
  });

  engine.placeOrder({
    coin, side: closeSide, price: setup.slPrice.toFixed(2), size: sizeStr,
    reduceOnly: false,
    orderType: { trigger: { isMarket: true, triggerPx: setup.slPrice.toFixed(2), tpsl: 'sl' } },
  });

  useTradeSetupStore.getState().removeSetup(setupId);
  return { assetSize, sizeStr };
}

describe('trade setup execute flow', () => {
  let engine: PaperEngine;

  beforeEach(() => {
    engine = new PaperEngine({ initialBalance: '10000', leverage: 10 });
    useTradeSetupStore.setState({ activeSetups: [], pendingSetup: null });
    useSettingsStore.setState({ riskUsdc: '100' });
  });

  it('creates setup with correct size from risk', () => {
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    const setup = store.addClick(54000)!;

    expect(setup.side).toBe('buy');
    expect(setup.entryPrice).toBe(50000);
    expect(setup.slPrice).toBe(48000);
    expect(setup.tpPrice).toBe(54000);
    // risk=100, |entry-sl|=2000, assetSize = 100/2000 = 0.05
    expect(setup.assetSize).toBe(0.05);
    expect(setup.rr).toBe(2);
  });

  it('short setup sorts prices correctly', () => {
    useSettingsStore.setState({ riskUsdc: '10' });
    const store = useTradeSetupStore.getState();
    store.startSetup('sell');
    store.addClick(50000);
    store.addClick(52000);
    const setup = store.addClick(46000)!;

    expect(setup.entryPrice).toBe(50000);
    expect(setup.slPrice).toBe(52000);
    expect(setup.tpPrice).toBe(46000);
  });

  it('long setup: entry fills → TP fills → position closed', () => {
    useSettingsStore.setState({ riskUsdc: '100' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    store.addClick(54000);

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    executeSetup(engine, setupId, 'BTC');

    expect(engine.getOpenOrders()).toHaveLength(3);

    // Entry fills
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);
    expect(engine.getOpenOrders()).toHaveLength(2);

    // TP fills
    engine.onPriceUpdate('BTC', '54000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('long setup: entry fills → SL fills → position closed', () => {
    useSettingsStore.setState({ riskUsdc: '100' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    store.addClick(54000);

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    executeSetup(engine, setupId, 'BTC');

    engine.onPriceUpdate('BTC', '50000'); // entry
    engine.onPriceUpdate('BTC', '48000'); // SL

    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('short setup: entry fills → TP fills', () => {
    useSettingsStore.setState({ riskUsdc: '100' });
    const store = useTradeSetupStore.getState();
    store.startSetup('sell');
    store.addClick(52000); // SL
    store.addClick(50000); // entry
    store.addClick(46000); // TP

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    executeSetup(engine, setupId, 'BTC');

    engine.onPriceUpdate('BTC', '50000'); // entry fills (sell limit)
    expect(engine.getPositions()).toHaveLength(1);
    expect(engine.getPosition('BTC')!.szi.isNeg()).toBe(true);

    engine.onPriceUpdate('BTC', '46000'); // TP triggers (buy)
    expect(engine.getPositions()).toHaveLength(0);
  });

  it('tight stop: margin rejection when risk sizing produces oversized position', () => {
    const rejections: string[] = [];
    engine = new PaperEngine({
      initialBalance: '10000',
      leverage: 10,
      onRejection: (reason) => rejections.push(reason),
    });

    // $50 risk, $1 stop → 50 BTC = $2.5M notional = $250k margin
    useSettingsStore.setState({ riskUsdc: '50' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(49999);  // SL
    store.addClick(50000);  // entry
    store.addClick(50100);  // TP

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    executeSetup(engine, setupId, 'BTC');

    engine.onPriceUpdate('BTC', '50000');

    expect(engine.getPositions()).toHaveLength(0);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toContain('Insufficient margin');
  });

  it('TP/SL do not open positions if entry never fills', () => {
    useSettingsStore.setState({ riskUsdc: '100' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);  // SL
    store.addClick(50000);  // entry
    store.addClick(54000);  // TP

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    executeSetup(engine, setupId, 'BTC');

    // Price rises above TP without entry ever filling
    // TP sell triggers (midPrice >= 54000) → removed with no position
    // SL sell does NOT trigger (midPrice > 48000, needs <=)
    engine.onPriceUpdate('BTC', '55000');

    expect(engine.getPositions()).toHaveLength(0);
    // Entry limit + SL still open (TP was removed, entry didn't fill)
    expect(engine.getOpenOrders()).toHaveLength(2);

    // Now price drops below SL — SL triggers, also removed with no position
    engine.onPriceUpdate('BTC', '47000');

    // Entry limit fills at this price (47000 <= 50000)
    // But the entry fill creates a position, and SL triggers on same tick...
    // Actually: matchOrders runs first, both entry and SL match.
    // Entry fills first (creates long), SL fills second (closes long).
    // This is actually correct behavior — price gapped through entry and SL.
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('risk recalculation at execute uses current settings value', () => {
    useSettingsStore.setState({ riskUsdc: '100' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    store.addClick(54000);

    // Change risk after setup creation
    useSettingsStore.setState({ riskUsdc: '200' });

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    const { assetSize } = executeSetup(engine, setupId, 'BTC');

    // 200 / 2000 = 0.1 (not 0.05 from original setup)
    expect(assetSize).toBe(0.1);
  });
});

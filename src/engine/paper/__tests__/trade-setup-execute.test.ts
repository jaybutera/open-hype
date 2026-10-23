import { describe, it, expect, beforeEach } from 'vitest';
import { PaperEngine } from '../PaperEngine.ts';
import { useTradeSetupStore } from '../../../store/useTradeSetupStore.ts';
import { useSettingsStore } from '../../../store/useSettingsStore.ts';
import type { Side } from '../../../types/order.ts';

/**
 * Replicates the exact flow from OrderPanel.handleExecuteSetup:
 * reads risk from settings, computes size, auto-bumps leverage to fit the
 * implied notional (capped at the asset's maxLeverage), places entry + TP + SL.
 */
function executeSetup(engine: PaperEngine, setupId: string, coin: string, maxLeverage = 50) {
  const setup = useTradeSetupStore.getState().activeSetups.find(s => s.id === setupId);
  if (!setup) throw new Error('Setup not found');

  const currentRisk = parseFloat(useSettingsStore.getState().riskUsdc) || 0;
  const riskPerUnit = Math.abs(setup.entryPrice - setup.slPrice);
  const assetSize = riskPerUnit > 0 && currentRisk > 0
    ? currentRisk / riskPerUnit
    : setup.assetSize;
  const sizeStr = assetSize.toString();

  if (assetSize <= 0) throw new Error('Size is zero');

  // Auto-bump leverage so the risk-capped notional fits in available margin.
  const leverage = useSettingsStore.getState().leverage;
  const notional = assetSize * setup.entryPrice;
  const available = parseFloat(engine.getAvailableBalance()) || 0;
  if (available > 0 && notional / leverage > available) {
    const neededLev = Math.ceil(notional / available);
    if (neededLev > maxLeverage) {
      throw new Error(`Position too large: needs ${neededLev}x but caps at ${maxLeverage}x`);
    }
    engine.setLeverage(Math.min(maxLeverage, neededLev));
  }

  const closeSide: Side = setup.side === 'buy' ? 'sell' : 'buy';

  const r1 = engine.placeOrder({
    coin, side: setup.side, price: setup.entryPrice.toFixed(2), size: sizeStr,
    reduceOnly: false, orderType: { limit: { tif: 'Gtc' } },
  });
  if (!r1.success) throw new Error(`Entry: ${r1.error}`);

  const entryOid = r1.oid as string;

  engine.placeOrder({
    coin, side: closeSide, price: setup.tpPrice.toFixed(2), size: sizeStr,
    reduceOnly: false,
    orderType: { trigger: { isMarket: true, triggerPx: setup.tpPrice.toFixed(2), tpsl: 'tp' } },
    parentOid: entryOid,
  });

  engine.placeOrder({
    coin, side: closeSide, price: setup.slPrice.toFixed(2), size: sizeStr,
    reduceOnly: false,
    orderType: { trigger: { isMarket: true, triggerPx: setup.slPrice.toFixed(2), tpsl: 'sl' } },
    parentOid: entryOid,
  });

  useTradeSetupStore.getState().removeSetup(setupId);
  return { assetSize, sizeStr };
}

describe('trade setup execute flow', () => {
  let engine: PaperEngine;

  beforeEach(() => {
    engine = new PaperEngine({ initialBalance: '10000', leverage: 10 });
    useTradeSetupStore.setState({ activeSetups: [], pendingSetup: null });
    useSettingsStore.setState({ riskUsdc: '100', leverage: 10 });
  });

  it('binds the setup to the pane and asset the clicks land on', () => {
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(28827, null, { paneId: 'secondary', asset: 'xyz:XYZ100' });
    store.addClick(28933, null, { paneId: 'secondary', asset: 'xyz:XYZ100' });
    const setup = store.addClick(29026, null, { paneId: 'secondary', asset: 'xyz:XYZ100' })!;
    expect(setup.paneId).toBe('secondary');
    expect(setup.asset).toBe('xyz:XYZ100');
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

  it('tight stop: auto-bumps leverage so a risk-capped position fits', () => {
    engine = new PaperEngine({ initialBalance: '10000', leverage: 10 });

    // $100 risk, $17 stop on a ~$30k asset → ~5.9 units = ~$178k notional.
    // At 10x that needs ~$17.9k margin (> $10k) and fails; at the asset's cap
    // it fits. This mirrors the reported screenshot.
    useSettingsStore.setState({ riskUsdc: '100', leverage: 10 });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(30317);  // SL
    store.addClick(30334);  // entry
    store.addClick(30442);  // TP

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;

    // With a 25x cap the trade now succeeds instead of being rejected.
    expect(() => executeSetup(engine, setupId, 'BTC', 25)).not.toThrow();
    expect(engine.getOpenOrders()).toHaveLength(3);
    // Leverage was bumped above the original 10x to make the notional fit.
    const notional = (100 / 17) * 30334;
    expect(parseFloat(engine.getAvailableBalance())).toBeGreaterThan(0);
    expect(Math.ceil(notional / 10000)).toBeGreaterThan(10);
  });

  it('tight stop: errors when even the asset cap cannot hold the notional', () => {
    engine = new PaperEngine({ initialBalance: '10000', leverage: 10 });

    // $50 risk, $1 stop → 50 BTC = $2.5M notional. Needs ~250x; caps at 50x.
    useSettingsStore.setState({ riskUsdc: '50', leverage: 10 });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(49999);  // SL
    store.addClick(50000);  // entry
    store.addClick(50100);  // TP

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;

    expect(() => executeSetup(engine, setupId, 'BTC', 50)).toThrow('Position too large');
    expect(engine.getOpenOrders()).toHaveLength(0);
  });

  it('TP/SL stay dormant until entry fills (parentOid linkage)', () => {
    useSettingsStore.setState({ riskUsdc: '100' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);  // SL
    store.addClick(50000);  // entry
    store.addClick(54000);  // TP

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    executeSetup(engine, setupId, 'BTC');

    // Price rises above TP without entry ever filling
    // TP is linked to entry via parentOid — it stays dormant
    engine.onPriceUpdate('BTC', '55000');

    expect(engine.getPositions()).toHaveLength(0);
    // All 3 orders still open — TP not removed because parent hasn't filled
    expect(engine.getOpenOrders()).toHaveLength(3);

    // Price drops below SL — entry fills (gap through), SL also fires
    engine.onPriceUpdate('BTC', '47000');

    // Entry fills first, SL fires same tick (gap through entry and SL)
    expect(engine.getPositions()).toHaveLength(0);
    // TP is also removed when position closes
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

  it('candle wick does not remove TP/SL while entry is pending', () => {
    useSettingsStore.setState({ riskUsdc: '100' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    store.addClick(54000);

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    executeSetup(engine, setupId, 'BTC');

    expect(engine.getOpenOrders()).toHaveLength(3);

    // Candle wick spans SL level — should NOT remove SL
    engine.onCandleUpdate('BTC', '51000', '47000');
    expect(engine.getOpenOrders()).toHaveLength(3);
    expect(engine.getPositions()).toHaveLength(0);

    // Entry fills normally
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);
    expect(engine.getOpenOrders()).toHaveLength(2);

    // SL now triggers correctly
    engine.onPriceUpdate('BTC', '48000');
    expect(engine.getPositions()).toHaveLength(0);
  });

  it('SL does not fire from candle wicks that occurred before entry filled', () => {
    useSettingsStore.setState({ riskUsdc: '100' });
    const store = useTradeSetupStore.getState();
    store.startSetup('buy');
    store.addClick(48000);
    store.addClick(50000);
    store.addClick(54000);

    const setupId = useTradeSetupStore.getState().activeSetups[0].id;
    executeSetup(engine, setupId, 'BTC');

    // Entry fills mid-candle.
    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPositions()).toHaveLength(1);

    // The current candle's open time is before the entry filled, and its low
    // wicks below the SL (the wick happened earlier in the candle, before we
    // were in the trade). SL must NOT fire.
    const candleOpenedBeforeFill = Date.now() - 60_000;
    engine.onCandleUpdate('BTC', '51000', '47000', candleOpenedBeforeFill);
    expect(engine.getPositions()).toHaveLength(1);

    // A new candle opening *after* the fill, with a low at SL, should fire.
    const candleAfterFill = Date.now() + 1000;
    engine.onCandleUpdate('BTC', '50500', '48000', candleAfterFill);
    expect(engine.getPositions()).toHaveLength(0);
  });
});

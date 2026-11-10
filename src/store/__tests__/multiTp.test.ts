import { describe, it, expect, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { useTradeSetupStore, evenSplit, tpLegSizes, MAX_TPS } from '../useTradeSetupStore.ts';
import { useSettingsStore } from '../useSettingsStore.ts';
import { PaperEngine } from '../../engine/paper/PaperEngine.ts';

const at = { paneId: 'primary' as const, asset: 'BTC' };
const st = () => useTradeSetupStore.getState();
const only = () => st().activeSetups[0];

beforeEach(() => {
  useTradeSetupStore.setState({ activeSetups: [], pendingSetup: null, addingTpTo: null });
  useSettingsStore.setState({ riskUsdc: '100' });
});

describe('drawing a setup with several TPs', () => {
  it('shift-start long: ctrl+clicks add TPs, the plain click that gives an SL finishes it, in any order', () => {
    st().startSetupAt('buy', 50000, null, at);
    expect(st().addClick(56000, null, at, true)).toBeNull();
    expect(st().addClick(54000, null, at, true)).toBeNull();
    const setup = st().addClick(48000, null, at)!;
    expect(setup.slPrice).toBe(48000);
    expect(setup.tps.map(t => t.price)).toEqual([54000, 56000]);
    expect(setup.tps.map(t => t.pct)).toEqual([50, 50]);
    expect(setup.tpPrice).toBe(54000);
    // 0.05 BTC: half to 54000 (+100), half to 56000 (+150); R 2 and 3 blend to 2.5
    expect(setup.potentialPnl).toBeCloseTo(250, 8);
    expect(setup.rr).toBeCloseTo(2.5, 8);
  });

  it('shift-start: a plain TP click before any SL keeps collecting; the SL click finishes', () => {
    st().startSetupAt('sell', 50000, null, at);
    expect(st().addClick(46000, null, at)).toBeNull();
    const setup = st().addClick(52000, null, at)!;
    expect(setup.slPrice).toBe(52000);
    expect(setup.tps.map(t => t.price)).toEqual([46000]);
  });

  it('shift-start: a second loss-side click moves the SL rather than adding one', () => {
    st().startSetupAt('buy', 50000, null, at);
    st().addClick(48000, null, at, true);
    st().addClick(49000, null, at, true);
    expect(st().pendingSetup!.clicks).toEqual([50000, 49000]);
    const setup = st().addClick(53000, null, at)!;
    expect(setup.slPrice).toBe(49000);
  });

  it('Enter finishes a setup that is ready, and does nothing before', () => {
    st().startSetupAt('buy', 50000, null, at);
    st().addClick(52000, null, at, true);
    expect(st().finishPending()).toBeNull();
    st().addClick(49000, null, at, true);
    expect(st().finishPending()!.tps).toHaveLength(1);
  });

  it('button start: clicks sort from the stop side, so extra clicks past TP1 are further TPs', () => {
    st().startSetup('sell');
    st().addClick(44000, null, at, true);
    st().addClick(52000, null, at, true);
    st().addClick(46000, null, at, true);
    const setup = st().addClick(50000, null, at)!;
    expect(setup.slPrice).toBe(52000);
    expect(setup.entryPrice).toBe(50000);
    expect(setup.tps.map(t => t.price)).toEqual([46000, 44000]);
  });
});

describe('editing TPs on a drawn setup', () => {
  function draw() {
    st().startSetupAt('buy', 50000, null, at);
    st().addClick(48000, null, at);
    return st().addClick(54000, null, at)!;
  }

  it('+TP adds a leg on the profit side only, re-splits evenly and keeps legs nearest first', () => {
    const s = draw();
    st().startAddTp(s.id);
    expect(st().addTp(s.id, 49000)).toBe(false);
    expect(st().addingTpTo).toBeNull();
    expect(st().addTp(s.id, 52000)).toBe(true);
    expect(only().tps.map(t => [t.price, t.pct])).toEqual([[52000, 50], [54000, 50]]);
    expect(only().tpPrice).toBe(52000);
    st().addTp(s.id, 56000);
    expect(only().tps.map(t => t.pct)).toEqual([33, 33, 34]);
  });

  it(`stops at ${MAX_TPS} legs`, () => {
    const s = draw();
    for (let i = 1; i < MAX_TPS; i++) expect(st().addTp(s.id, 54000 + i * 500)).toBe(true);
    expect(st().addTp(s.id, 60000)).toBe(false);
    expect(only().tps).toHaveLength(MAX_TPS);
  });

  it('removing a leg re-splits the rest; the last leg stays', () => {
    const s = draw();
    st().addTp(s.id, 56000);
    st().addTp(s.id, 58000);
    st().removeTp(s.id, only().tps[1].id);
    expect(only().tps.map(t => [t.price, t.pct])).toEqual([[54000, 50], [58000, 50]]);
    st().removeTp(s.id, only().tps[0].id);
    st().removeTp(s.id, only().tps[0].id);
    expect(only().tps.map(t => [t.price, t.pct])).toEqual([[58000, 100]]);
  });

  it('scrolling a share trades it with the farthest other leg, never below 5%', () => {
    const s = draw();
    st().addTp(s.id, 56000);
    const [a, b] = only().tps;
    st().nudgeTpPct(s.id, a.id, 5);
    expect(only().tps.map(t => t.pct)).toEqual([55, 45]);
    st().nudgeTpPct(s.id, b.id, -100);
    expect(only().tps.map(t => t.pct)).toEqual([95, 5]);
    st().nudgeTpPct(s.id, a.id, 5);
    expect(only().tps.map(t => t.pct)).toEqual([95, 5]);
  });

  it('dragging a TP past another re-sorts the legs and TP1 follows', () => {
    const s = draw();
    st().addTp(s.id, 56000);
    const near = only().tps[0];
    st().updateSetup(s.id, `tp:${near.id}`, 57000);
    expect(only().tps.map(t => t.price)).toEqual([56000, 57000]);
    expect(only().tps[1].id).toBe(near.id);
    expect(only().tpPrice).toBe(56000);
  });
});

describe('split TP execution on the paper engine', () => {
  it('legs add up to the size exactly', () => {
    expect(evenSplit(3)).toEqual([33, 33, 34]);
    const tps = evenSplit(3).map((pct, i) => ({ id: String(i), price: 0, pct }));
    const sizes = tpLegSizes(tps, 0.07);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(0.07);
  });

  it('TP1 closes its share, the SL then closes only what is left', () => {
    const engine = new PaperEngine({ initialBalance: '10000', leverage: 10 });
    st().startSetupAt('buy', 50000, null, at);
    st().addClick(56000, null, at, true);
    st().addClick(54000, null, at, true);
    const setup = st().addClick(48000, null, at)!;

    const entry = engine.placeOrder({ coin: 'BTC', side: 'buy', price: '50000', size: String(setup.assetSize), reduceOnly: false, orderType: { limit: { tif: 'Gtc' } } });
    const legs = tpLegSizes(setup.tps, setup.assetSize);
    setup.tps.forEach((tp, i) => engine.placeOrder({
      coin: 'BTC', side: 'sell', price: String(tp.price), size: String(legs[i]), reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: String(tp.price), tpsl: 'tp' } }, parentOid: entry.oid as string,
    }));
    engine.placeOrder({
      coin: 'BTC', side: 'sell', price: '48000', size: String(setup.assetSize), reduceOnly: false,
      orderType: { trigger: { isMarket: true, triggerPx: '48000', tpsl: 'sl' } }, parentOid: entry.oid as string,
    });

    engine.onPriceUpdate('BTC', '50000');
    expect(engine.getPosition('BTC')!.szi.toNumber()).toBeCloseTo(0.05, 10);
    engine.onPriceUpdate('BTC', '54000');
    expect(engine.getPosition('BTC')!.szi.toNumber()).toBeCloseTo(0.025, 10);
    expect(engine.getOpenOrders()).toHaveLength(2);
    engine.onPriceUpdate('BTC', '48000');
    expect(engine.getPositions()).toHaveLength(0);
    expect(engine.getOpenOrders()).toHaveLength(0);
    // +100 on TP1's half, -50 on the stopped half, before fees
    const pnl = engine.getFills().reduce((a, f) => a.add(f.realizedPnl), new Decimal(0));
    expect(pnl.toNumber()).toBeCloseTo(50, 6);
  });
});

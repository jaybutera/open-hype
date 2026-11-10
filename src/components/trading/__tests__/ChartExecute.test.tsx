// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { Wallet } from 'ethers';
import { OrderPanel } from '../OrderPanel.tsx';
import { TradeBoxPrimitive } from '../../chart/TradeBoxPrimitive.ts';
import { useTradeSetupStore, type TradeSetup } from '../../../store/useTradeSetupStore.ts';
import { useSettingsStore } from '../../../store/useSettingsStore.ts';
import { useMarketStore } from '../../../store/useMarketStore.ts';
import { useWalletStore } from '../../../store/useWalletStore.ts';
import { useLiveAccountStore } from '../../../store/useLiveAccountStore.ts';
import { MockWalletProvider, stubHyperliquidFetch, META, XYZ_META } from '../../../test/hlMocks.ts';
import type { PaperEngine } from '../../../engine/paper/PaperEngine.ts';
import type { Meta } from '../../../types/market.ts';

const SETUP: TradeSetup = {
  id: 'setup-1', side: 'buy', entryPrice: 59000, slPrice: 58900, tpPrice: 59300,
  tps: [{ id: 'tp-1', price: 59300, pct: 100 }],
  assetSize: 0.1, riskUsdc: 10, potentialPnl: 30, potentialLoss: 10, rr: 3,
  paneId: 'primary', asset: 'BTC',
};

const WIDTH = 800;
const ENTRY_Y = 200;

/** A primitive attached to a fake series with the entry at y=200, drawn once at width 800. */
function chartBox() {
  const st = useTradeSetupStore.getState();
  const prim = new TradeBoxPrimitive(SETUP, {
    onExecute: st.requestExecute, onRemove: st.removeSetup, onDrag: st.updateSetup,
    onAddTp: st.startAddTp, onRemoveTp: st.removeTp, onNudgeTp: st.nudgeTpPct,
  });
  const series = { priceToCoordinate: (p: number) => (p === SETUP.entryPrice ? ENTRY_Y : p > SETUP.entryPrice ? 100 : 300) };
  prim.attached({ series, requestUpdate: () => {} } as any);
  prim._width = WIDTH;
  return prim;
}

function clickExecute(prim: TradeBoxPrimitive) {
  const r = prim.layout()!.execute;
  let took = false;
  act(() => { took = prim.handleButtonClick(r.x + r.w / 2, r.y + r.h / 2); });
  return took;
}

let scrolled: Element[];

beforeEach(() => {
  localStorage.clear();
  useMarketStore.setState({ meta: META as unknown as Meta, xyzMeta: XYZ_META as unknown as Meta, allMids: { BTC: '60000' } });
  useTradeSetupStore.setState({ activeSetups: [SETUP], pendingSetup: null, executeRequest: null });
  useSettingsStore.setState({ riskUsdc: '10', leverage: 3, side: 'buy', sizeUsdc: '120' });
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); } as any;
});
afterEach(() => {
  useSettingsStore.setState({ mode: 'paper' });
  vi.unstubAllGlobals();
});

describe('chart trade box Execute', () => {
  it('button click outside the buttons does nothing', () => {
    const prim = chartBox();
    expect(prim.handleButtonClick(5, 5)).toBe(false);
    expect(useTradeSetupStore.getState().executeRequest).toBeNull();
  });

  it('paper: places entry, TP and SL once, even with two order panels', () => {
    useSettingsStore.setState({ mode: 'paper' });
    const placeOrder = vi.fn().mockReturnValue({ success: true, oid: 'p1' });
    const engine = { getAvailableBalance: () => '100000', setLeverage: vi.fn(), placeOrder, onPriceUpdate: () => {} } as unknown as PaperEngine;
    render(<><OrderPanel engine={engine} /><OrderPanel engine={engine} /></>);

    expect(clickExecute(chartBox())).toBe(true);

    expect(placeOrder).toHaveBeenCalledTimes(3);
    expect(placeOrder.mock.calls[0][0]).toMatchObject({ coin: 'BTC', side: 'buy', price: '59000.00', size: '0.1' });
    expect(placeOrder.mock.calls[1][0].orderType.trigger).toMatchObject({ tpsl: 'tp', triggerPx: '59300.00' });
    expect(placeOrder.mock.calls[2][0].orderType.trigger).toMatchObject({ tpsl: 'sl', triggerPx: '58900.00' });
    expect(useTradeSetupStore.getState().activeSetups).toHaveLength(0);
    expect(useTradeSetupStore.getState().executeRequest).toBeNull();
  });

  it('paper: one TP trigger per leg sized by its share, SL on the whole size', () => {
    useSettingsStore.setState({ mode: 'paper' });
    useTradeSetupStore.setState({
      activeSetups: [{ ...SETUP, tps: [{ id: 'a', price: 59300, pct: 60 }, { id: 'b', price: 59500, pct: 40 }] }],
    });
    const placeOrder = vi.fn().mockReturnValue({ success: true, oid: 'p1' });
    const engine = { getAvailableBalance: () => '100000', setLeverage: vi.fn(), placeOrder, onPriceUpdate: () => {} } as unknown as PaperEngine;
    render(<OrderPanel engine={engine} />);

    act(() => useTradeSetupStore.getState().requestExecute(SETUP.id));

    expect(placeOrder).toHaveBeenCalledTimes(4);
    const [, tp1, tp2, sl] = placeOrder.mock.calls.map(c => c[0]);
    expect(tp1.orderType.trigger).toMatchObject({ tpsl: 'tp', triggerPx: '59300.00' });
    expect(Number(tp1.size)).toBeCloseTo(0.06, 10);
    expect(tp2.orderType.trigger).toMatchObject({ tpsl: 'tp', triggerPx: '59500.00' });
    expect(Number(tp1.size) + Number(tp2.size)).toBe(0.1);
    expect(sl).toMatchObject({ size: '0.1' });
    expect(sl.orderType.trigger).toMatchObject({ tpsl: 'sl' });
    expect(useTradeSetupStore.getState().executeOutcome?.message).toBe('Setup executed — 4 orders placed');
  });

  it('live: a setup with several TPs is refused before anything is sent', async () => {
    useSettingsStore.setState({ mode: 'live' });
    useTradeSetupStore.setState({
      activeSetups: [{ ...SETUP, tps: [{ id: 'a', price: 59300, pct: 50 }, { id: 'b', price: 59500, pct: 50 }] }],
    });
    const net = stubHyperliquidFetch();
    const owner = new Wallet('0x' + '58'.repeat(32)).address;
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '68'.repeat(32)).privateKey, owner));
    const engine = { getAvailableBalance: () => '0', setLeverage: () => {}, placeOrder: vi.fn(), onPriceUpdate: () => {} } as unknown as PaperEngine;
    render(<OrderPanel engine={engine} />);

    act(() => useTradeSetupStore.getState().requestExecute(SETUP.id));

    expect(await screen.findByText(/2 TPs run on paper only/)).toBeInTheDocument();
    expect(net.exchangeCalls()).toHaveLength(0);
    expect(useTradeSetupStore.getState().activeSetups).toHaveLength(1);
    act(() => useWalletStore.getState().disconnect());
  });

  it('paper: an error is scrolled into view', () => {
    useSettingsStore.setState({ mode: 'paper' });
    const placeOrder = vi.fn().mockReturnValue({ success: false, error: 'Insufficient margin' });
    const engine = { getAvailableBalance: () => '100000', setLeverage: vi.fn(), placeOrder, onPriceUpdate: () => {} } as unknown as PaperEngine;
    render(<OrderPanel engine={engine} />);

    clickExecute(chartBox());

    const err = screen.getByText('Entry failed: Insufficient margin');
    expect(scrolled).toContain(err);
  });

  it('live: sends the order straight to the exchange with no confirm card', async () => {
    useSettingsStore.setState({ mode: 'live' });
    (window as any).ethereum = new MockWalletProvider([new Wallet('0x' + '55'.repeat(32))]);
    const net = stubHyperliquidFetch();
    const owner = new Wallet('0x' + '55'.repeat(32)).address;
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, owner));
    const placeOrder = vi.fn();
    const engine = { getAvailableBalance: () => '0', setLeverage: () => {}, placeOrder, onPriceUpdate: () => {} } as unknown as PaperEngine;
    render(<OrderPanel engine={engine} />);

    clickExecute(chartBox());

    await waitFor(() => expect(net.exchangeCalls().some(c => c.action.type === 'order')).toBe(true));
    expect(screen.queryByTestId('live-confirm')).toBeNull();
    expect(placeOrder).not.toHaveBeenCalled();
    delete (window as any).ethereum;
    act(() => useWalletStore.getState().disconnect());
  });
  /** Unified account worth $1,682.42 of spot USDC, all of it free after maintenance. */
  const unifiedAccount = (body: any) => {
    switch (body?.type) {
      case 'userAbstraction': return 'unifiedAccount';
      case 'spotClearinghouseState': return {
        balances: [{ coin: 'USDC', token: 0, total: '1682.42', hold: '0' }],
        tokenToAvailableAfterMaintenance: [[0, '1682.42']],
      };
      case 'clearinghouseState': return {
        marginSummary: { accountValue: '1682.42', totalMarginUsed: '0' }, withdrawable: '1682.42', assetPositions: [],
      };
      default: return undefined;
    }
  };

  function liveSetup(setup: TradeSetup, key: string) {
    useSettingsStore.setState({ mode: 'live', riskUsdc: '20', leverage: 10 });
    useMarketStore.setState({ allMids: { BTC: '80922' } });
    useTradeSetupStore.setState({ activeSetups: [setup] });
    useLiveAccountStore.getState().reset();
    const net = stubHyperliquidFetch({
      info: unifiedAccount,
      exchange: b => (b.action.type === 'order'
        ? { status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 9 } }] } } }
        : { status: 'ok', response: { type: 'default' } }),
    });
    const owner = new Wallet('0x' + key.repeat(32)).address;
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '77'.repeat(32)).privateKey, owner));
    const engine = { getAvailableBalance: () => '0', setLeverage: vi.fn(), placeOrder: vi.fn(), onPriceUpdate: () => {} } as unknown as PaperEngine;
    render(<OrderPanel engine={engine} />);
    act(() => useTradeSetupStore.getState().requestExecute(setup.id));
    return net;
  }

  it('live: a tight risk-sized stop raises leverage to fit free margin before the order', async () => {
    // $20 risk, entry 80922, SL 80873: 0.40816 BTC, ~$33k notional on $1,682.42 at 10x.
    const net = liveSetup({ ...SETUP, id: 'tight', entryPrice: 80922, slPrice: 80873, tpPrice: 81100, tps: [{ id: 'tp-1', price: 81100, pct: 100 }] }, 'a1');

    await waitFor(() => expect(net.exchangeCalls().some(c => c.action.type === 'order')).toBe(true));
    const calls = net.exchangeCalls();
    expect(calls.map(c => c.action.type)).toEqual(['updateLeverage', 'order']);
    expect(calls[0].action).toMatchObject({ asset: 0, isCross: true });
    expect(calls[0].action.leverage).toBeGreaterThanOrEqual(20);
    expect(calls[0].action.leverage).toBeLessThanOrEqual(21);
    expect(calls[1].action.orders[0]).toMatchObject({ b: true, p: '80922', s: '0.40816' });
    expect(useSettingsStore.getState().leverage).toBe(calls[0].action.leverage);
    expect(await screen.findByText('resting #9')).toBeInTheDocument();
    act(() => useWalletStore.getState().disconnect());
  });

  it('live: a stop too tight for the asset cap shows the error and sends nothing', async () => {
    // $20 over $1: 20 BTC, ~$1.6M notional, past 40x on $1,682.42.
    const net = liveSetup({ ...SETUP, id: 'too-tight', entryPrice: 80922, slPrice: 80921, tpPrice: 81100, tps: [{ id: 'tp-1', price: 81100, pct: 100 }] }, 'a2');

    expect(await screen.findByText(/Position too large: .* caps at 40x .* Widen the stop or lower risk\./)).toBeInTheDocument();
    expect(net.exchangeCalls()).toHaveLength(0);
    expect(useSettingsStore.getState().leverage).toBe(10);
    expect(useTradeSetupStore.getState().activeSetups).toHaveLength(1);
    act(() => useWalletStore.getState().disconnect());
  });
});

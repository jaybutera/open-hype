// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { Wallet } from 'ethers';
import { OrderPanel } from '../OrderPanel.tsx';
import { TradeBoxPrimitive, tradeBoxButtonRects } from '../../chart/TradeBoxPrimitive.ts';
import { useTradeSetupStore, type TradeSetup } from '../../../store/useTradeSetupStore.ts';
import { useSettingsStore } from '../../../store/useSettingsStore.ts';
import { useMarketStore } from '../../../store/useMarketStore.ts';
import { useWalletStore } from '../../../store/useWalletStore.ts';
import { MockWalletProvider, stubHyperliquidFetch, META, XYZ_META } from '../../../test/hlMocks.ts';
import type { PaperEngine } from '../../../engine/paper/PaperEngine.ts';
import type { Meta } from '../../../types/market.ts';

const SETUP: TradeSetup = {
  id: 'setup-1', side: 'buy', entryPrice: 59000, slPrice: 58900, tpPrice: 59300,
  assetSize: 0.1, riskUsdc: 10, potentialPnl: 30, potentialLoss: 10, rr: 3,
  paneId: 'primary', asset: 'BTC',
};

const WIDTH = 800;
const ENTRY_Y = 200;

/** A primitive attached to a fake series with the entry at y=200, drawn once at width 800. */
function chartBox() {
  const prim = new TradeBoxPrimitive(
    SETUP,
    useTradeSetupStore.getState().requestExecute,
    useTradeSetupStore.getState().removeSetup,
    useTradeSetupStore.getState().updateSetup,
  );
  const series = { priceToCoordinate: (p: number) => (p === SETUP.entryPrice ? ENTRY_Y : p > SETUP.entryPrice ? 100 : 300) };
  prim.attached({ series, requestUpdate: () => {} } as any);
  prim._width = WIDTH;
  return prim;
}

function clickExecute(prim: TradeBoxPrimitive) {
  const r = tradeBoxButtonRects(WIDTH, ENTRY_Y).execute;
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

  it('paper: an error is scrolled into view', () => {
    useSettingsStore.setState({ mode: 'paper' });
    const placeOrder = vi.fn().mockReturnValue({ success: false, error: 'Insufficient margin' });
    const engine = { getAvailableBalance: () => '100000', setLeverage: vi.fn(), placeOrder, onPriceUpdate: () => {} } as unknown as PaperEngine;
    render(<OrderPanel engine={engine} />);

    clickExecute(chartBox());

    const err = screen.getByText('Entry failed: Insufficient margin');
    expect(scrolled).toContain(err);
  });

  it('live: stages the confirm card and scrolls it into view; sends nothing yet', async () => {
    useSettingsStore.setState({ mode: 'live' });
    (window as any).ethereum = new MockWalletProvider([new Wallet('0x' + '55'.repeat(32))]);
    const net = stubHyperliquidFetch();
    const owner = new Wallet('0x' + '55'.repeat(32)).address;
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, owner));
    const placeOrder = vi.fn();
    const engine = { getAvailableBalance: () => '0', setLeverage: () => {}, placeOrder, onPriceUpdate: () => {} } as unknown as PaperEngine;
    render(<OrderPanel engine={engine} />);

    clickExecute(chartBox());

    const confirm = await screen.findByTestId('live-confirm');
    expect(confirm).toHaveTextContent('REAL ORDER on Hyperliquid mainnet');
    expect(screen.getByText('Confirm & send')).toBeInTheDocument();
    await waitFor(() => expect(scrolled.some(el => el.contains(confirm))).toBe(true));
    expect(net.exchangeCalls()).toHaveLength(0);
    expect(placeOrder).not.toHaveBeenCalled();
    delete (window as any).ethereum;
    act(() => useWalletStore.getState().disconnect());
  });
});

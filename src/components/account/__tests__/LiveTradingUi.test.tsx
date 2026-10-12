// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Wallet } from 'ethers';
import { WalletConnect } from '../WalletConnect.tsx';
import { LiveAccountSelector } from '../LiveAccountSelector.tsx';
import { OrderPanel } from '../../trading/OrderPanel.tsx';
import { useWalletStore } from '../../../store/useWalletStore.ts';
import { useSettingsStore } from '../../../store/useSettingsStore.ts';
import { useMarketStore } from '../../../store/useMarketStore.ts';
import { MockWalletProvider, stubHyperliquidFetch, META, XYZ_META } from '../../../test/hlMocks.ts';
import type { PaperEngine } from '../../../engine/paper/PaperEngine.ts';
import type { Meta } from '../../../types/market.ts';

const user = new Wallet('0x' + '55'.repeat(32));
let provider: MockWalletProvider;

beforeEach(() => {
  localStorage.clear();
  provider = new MockWalletProvider([user]);
  (window as any).ethereum = provider;
  useWalletStore.getState().disconnect();
  useMarketStore.setState({ meta: META as unknown as Meta, xyzMeta: XYZ_META as unknown as Meta, allMids: { BTC: '60000' } });
});
afterEach(() => {
  delete (window as any).ethereum;
  vi.unstubAllGlobals();
});

describe('WalletConnect', () => {
  it('connect → enable trading → disconnect', async () => {
    const net = stubHyperliquidFetch({ exchange: () => ({ status: 'ok', response: { type: 'default' } }) });
    render(<WalletConnect />);
    expect(screen.getByTestId('network-badge')).toHaveTextContent('MAINNET');

    fireEvent.click(screen.getByText('Connect wallet'));
    fireEvent.click(await screen.findByText('Browser wallet'));
    expect(await screen.findByTestId('wallet-address')).toHaveTextContent(`${user.address.slice(0, 6)}...${user.address.slice(-4)}`);

    fireEvent.click(screen.getByText('Enable trading'));
    expect(await screen.findByTestId('trading-ready')).toHaveTextContent('Trading enabled');
    expect(provider.signedTypedData).toHaveLength(1);
    expect((provider.signedTypedData[0] as any).primaryType).toBe('HyperliquidTransaction:ApproveAgent');
    expect(net.exchangeCalls()[0].action.type).toBe('approveAgent');

    fireEvent.click(screen.getByText('Disconnect'));
    expect(await screen.findByText('Connect wallet')).toBeInTheDocument();
  });

  it('shows wallet rejections as an alert', async () => {
    stubHyperliquidFetch();
    render(<WalletConnect />);
    fireEvent.click(screen.getByText('Connect wallet'));
    provider.rejectNext = { code: 4001, message: 'User rejected' };
    fireEvent.click(await screen.findByText('Browser wallet'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Request rejected in wallet');
  });

  it('explains when no wallet is installed and offers the API key path', async () => {
    delete (window as any).ethereum;
    render(<WalletConnect />);
    fireEvent.click(screen.getByText('Connect wallet'));
    expect(screen.getByText(/No browser wallet detected/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Use an API wallet key/));
    fireEvent.change(screen.getByPlaceholderText('API wallet private key'), { target: { value: ' bad key ' } });
    fireEvent.click(screen.getByText('Connect with key'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/64 hex/);
  });
});

describe('OrderPanel in live mode', () => {
  const engine = { getAvailableBalance: () => '0', setLeverage: () => {}, placeOrder: vi.fn(), onPriceUpdate: () => {} } as unknown as PaperEngine;

  beforeEach(() => {
    useSettingsStore.setState({ mode: 'live', side: 'buy', sizeUsdc: '120', leverage: 3 });
  });
  afterEach(() => useSettingsStore.setState({ mode: 'paper' }));

  it('blocks orders until trading is enabled', async () => {
    render(<OrderPanel engine={engine} />);
    expect(screen.getByText(/connect a wallet to place orders/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('60000'), { target: { value: '59000' } });
    fireEvent.click(screen.getByText(/Review Buy\/Long BTC/));
    expect(await screen.findByText('Connect a wallet first')).toBeInTheDocument();
    expect(engine.placeOrder).not.toHaveBeenCalled();
  });

  it('review shows exact payload; confirm sends it and reports the result; never touches paper engine', async () => {
    const net = stubHyperliquidFetch({
      exchange: b => (b.action.type === 'order'
        ? { status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 42 } }] } } }
        : { status: 'ok', response: { type: 'default' } }),
    });
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    render(<OrderPanel engine={engine} />);
    fireEvent.change(screen.getByPlaceholderText('60000'), { target: { value: '59000' } });
    fireEvent.click(screen.getByText(/Review Buy\/Long BTC/));

    const confirm = await screen.findByTestId('live-confirm');
    expect(confirm).toHaveTextContent('REAL ORDER on Hyperliquid mainnet');
    expect(confirm).toHaveTextContent('BUY 0.00203 BTC @ 59000');
    expect(JSON.parse(screen.getByTestId('live-payload').textContent!)).toEqual({
      orders: [{ a: 0, b: true, p: '59000', s: '0.00203', r: false, t: { limit: { tif: 'Gtc' } } }], grouping: 'na',
    });
    expect(net.exchangeCalls()).toHaveLength(0);

    fireEvent.click(screen.getByText('Confirm & send'));
    expect(await screen.findByText('resting #42')).toBeInTheDocument();
    expect(net.exchangeCalls().map(c => c.action.type)).toEqual(['updateLeverage', 'order']);
    expect(engine.placeOrder).not.toHaveBeenCalled();
  });

  it('cancel on the review sends nothing', async () => {
    const net = stubHyperliquidFetch();
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    render(<OrderPanel engine={engine} />);
    fireEvent.change(screen.getByPlaceholderText('60000'), { target: { value: '59000' } });
    fireEvent.click(screen.getByText(/Review Buy\/Long BTC/));
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(screen.queryByTestId('live-confirm')).toBeNull());
    expect(net.exchangeCalls()).toHaveLength(0);
  });
});

describe('LiveAccountSelector', () => {
  const sub = new Wallet('0x' + 'c3'.repeat(32)).address;
  const engine = { getAvailableBalance: () => '0', setLeverage: () => {}, placeOrder: vi.fn(), onPriceUpdate: () => {} } as unknown as PaperEngine;

  beforeEach(() => useSettingsStore.setState({ mode: 'live', side: 'buy', sizeUsdc: '120', leverage: 3 }));
  afterEach(() => useSettingsStore.setState({ mode: 'paper' }));

  it('hidden without sub-accounts', async () => {
    stubHyperliquidFetch();
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    render(<LiveAccountSelector />);
    await act(() => new Promise(r => setTimeout(r, 0)));
    expect(screen.queryByTestId('live-account-selector')).toBeNull();
  });

  it('lists master and sub-accounts; picking one routes the reviewed order to it', async () => {
    const net = stubHyperliquidFetch({
      info: b => (b.type === 'subAccounts'
        ? [{ name: 'Swing', subAccountUser: sub.toLowerCase(), master: user.address, clearinghouseState: { marginSummary: { accountValue: '250' } } }]
        : undefined),
      exchange: b => (b.action.type === 'order'
        ? { status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 7 } }] } } }
        : { status: 'ok', response: { type: 'default' } }),
    });
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    render(<><LiveAccountSelector /><OrderPanel engine={engine} /></>);

    const button = await screen.findByTestId('live-account-selector');
    expect(button).toHaveTextContent('Master Account');
    fireEvent.click(button);
    const options = screen.getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual([
      expect.stringContaining('Master Account'),
      expect.stringContaining('Swing$250.00'),
    ]);
    fireEvent.click(options[1]);
    expect(button).toHaveTextContent('Swing');

    fireEvent.change(screen.getByPlaceholderText('60000'), { target: { value: '59000' } });
    fireEvent.click(screen.getByText(/Review Buy\/Long BTC/));
    expect(await screen.findByTestId('live-confirm-account')).toHaveTextContent(`Sub-account Swing (${sub.slice(0, 6)}…${sub.slice(-4)})`);
    expect(JSON.parse(screen.getByTestId('live-payload').textContent!).vaultAddress).toBe(sub);

    fireEvent.click(screen.getByText('Confirm & send'));
    expect(await screen.findByText('resting #7')).toBeInTheDocument();
    expect(net.exchangeCalls().map(c => c.vaultAddress)).toEqual([sub.toLowerCase(), sub.toLowerCase()]);
  });
});

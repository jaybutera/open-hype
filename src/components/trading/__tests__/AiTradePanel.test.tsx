// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Wallet } from 'ethers';
import { AiTradePanel } from '../AiTradePanel.tsx';
import { useAiTradeStore } from '../../../store/useAiTradeStore.ts';
import { useSettingsStore } from '../../../store/useSettingsStore.ts';
import { useMarketStore } from '../../../store/useMarketStore.ts';
import { useWalletStore } from '../../../store/useWalletStore.ts';
import { useAccountStore } from '../../../store/useAccountStore.ts';
import { useLiveAccountStore, type LiveOpenOrder } from '../../../store/useLiveAccountStore.ts';
import { PaperEngine } from '../../../engine/paper/PaperEngine.ts';
import { startAiLink } from '../../../services/ai/link.ts';
import { previewTrade, executeTrade } from '../../../services/ai/tradeExec.ts';
import { stubHyperliquidFetch, META, XYZ_META } from '../../../test/hlMocks.ts';
import type { TradeAction, TradeProposal } from '../../../services/ai/trades.ts';
import type { Meta } from '../../../types/market.ts';

const user = new Wallet('0x' + '55'.repeat(32));
const NOW = Date.now();

function proposal(action: TradeAction, over: Partial<TradeProposal> = {}): TradeProposal {
  return { id: 't1', action, mode: 'paper', createdAt: NOW, expiresAt: NOW + 900_000, status: 'pending', ...over };
}

/** Hyperliquid stub plus the dev server's /api/ai/trades routes; records what the page posts there. */
function stubNet(exchange?: (b: any) => unknown) {
  const net = stubHyperliquidFetch({ exchange });
  const hl = globalThis.fetch as unknown as (url: string, init?: { body?: string }) => Promise<Response>;
  const ai: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.startsWith('/api/ai/')) {
      ai.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return hl(url, init);
  }));
  return { ...net, ai };
}

function liveOrder(over: Partial<LiveOpenOrder>): LiveOpenOrder {
  return {
    coin: 'BTC', oid: 1, side: 'buy', limitPx: '58000', sz: '0.01', origSz: '0.01', orderType: 'Limit',
    isTrigger: false, triggerPx: '0', triggerCondition: 'N/A', reduceOnly: false, isPositionTpsl: false, timestamp: 1, ...over,
  };
}

let engine: PaperEngine;

beforeEach(() => {
  localStorage.clear();
  useWalletStore.getState().disconnect();
  useAiTradeStore.setState({ trades: [], autoConfirm: false });
  useSettingsStore.setState({ mode: 'paper' });
  useMarketStore.setState({ meta: META as unknown as Meta, xyzMeta: XYZ_META as unknown as Meta, allMids: { BTC: '60000' } });
  engine = new PaperEngine({ onUpdate: s => useAccountStore.getState().updatePaperState(s) });
  useAccountStore.getState().updatePaperState(engine.getState());
  startAiLink(engine);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useSettingsStore.setState({ mode: 'paper' });
});

describe('AiTradePanel', () => {
  it('renders nothing without proposals', () => {
    const { container } = render(<AiTradePanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('paper: confirm places entry plus linked TP/SL in the paper account and reports back', async () => {
    const net = stubNet();
    act(() => useAiTradeStore.getState().receive([proposal(
      { kind: 'order', coin: 'BTC', side: 'buy', orderType: 'limit', price: 59000, riskUsd: 50, sl: 58500, tp: 61000 },
      { note: 'OB retest' },
    )]));
    render(<AiTradePanel />);
    const card = await screen.findByTestId('ai-trade-card');
    expect(card).toHaveTextContent('Claude proposes');
    expect(card).toHaveTextContent('PAPER');
    expect(card).toHaveTextContent('OB retest');
    expect(await screen.findByText('BUY 0.1 BTC limit @ 59000')).toBeInTheDocument();
    expect(card).toHaveTextContent('Sized for $50 risk to SL 58500');

    fireEvent.click(screen.getByText('Confirm & send'));
    await waitFor(() => expect(net.ai.map(c => c.url)).toEqual(['/api/ai/trades/claim?id=t1', '/api/ai/trades/result?id=t1']));
    expect(net.ai[0].body).toEqual({ decidedBy: 'user' });
    expect(net.ai[1].body).toMatchObject({ ok: true, message: expect.stringMatching(/^placed #paper-ord-\d+ \| TP #paper-ord-\d+ \| SL #paper-ord-\d+$/) });
    // The same store the chart and order table read.
    const orders = useAccountStore.getState().paperOrders;
    expect(orders.map(o => [o.type, o.tpsl ?? null, o.price.toNumber(), o.size.toNumber()])).toEqual([
      ['limit', null, 59000, 0.1], ['trigger', 'tp', 61000, 0.1], ['trigger', 'sl', 58500, 0.1],
    ]);
    expect(net.exchangeCalls()).toHaveLength(0);
  });

  it('refuses to run in the other mode and lets the user reject', async () => {
    const net = stubNet();
    act(() => useAiTradeStore.getState().receive([proposal({ kind: 'close', coin: 'BTC' }, { mode: 'live' })]));
    render(<AiTradePanel />);
    expect(await screen.findByTestId('ai-trade-error')).toHaveTextContent('Proposed for live; switch the app to live mode to confirm');
    expect(screen.getByText('Confirm & send')).toBeDisabled();
    fireEvent.click(screen.getByText('Reject'));
    await waitFor(() => expect(net.ai.map(c => c.url)).toEqual(['/api/ai/trades/reject?id=t1']));
  });

  it('live: shows the exact payload and signs it with the page key on confirm', async () => {
    const net = stubNet(b => (b.action.type === 'order'
      ? { status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 42 } }] } } }
      : { status: 'ok', response: { type: 'default' } }));
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    useSettingsStore.setState({ mode: 'live' });
    act(() => useAiTradeStore.getState().receive([proposal(
      { kind: 'order', coin: 'BTC', side: 'buy', orderType: 'limit', price: 59000, size: 0.002 }, { mode: 'live' },
    )]));
    render(<AiTradePanel />);
    expect(await screen.findByTestId('live-confirm')).toHaveTextContent('REAL ORDER on Hyperliquid mainnet');
    expect(JSON.parse(screen.getByTestId('live-payload').textContent!)).toEqual({
      orders: [{ a: 0, b: true, p: '59000', s: '0.002', r: false, t: { limit: { tif: 'Gtc' } } }], grouping: 'na',
    });
    expect(net.exchangeCalls()).toHaveLength(0);

    fireEvent.click(screen.getByText('Confirm & send'));
    await waitFor(() => expect(net.ai.map(c => c.url)).toEqual(['/api/ai/trades/claim?id=t1', '/api/ai/trades/result?id=t1']));
    expect(net.ai[1].body).toEqual({ ok: true, message: 'resting #42' });
    expect(net.exchangeCalls().map(c => c.action.type)).toEqual(['order']);
  });

  it('live: auto-run cancels without a click', async () => {
    const net = stubNet(b => (b.action.type === 'cancel'
      ? { status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } }
      : { status: 'ok', response: { type: 'default' } }));
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    useSettingsStore.setState({ mode: 'live' });
    useLiveAccountStore.setState({ openOrders: [liveOrder({ oid: 7 })] });
    useAiTradeStore.setState({ autoConfirm: true });
    act(() => useAiTradeStore.getState().receive([proposal({ kind: 'cancel', coin: 'BTC', oids: [7] }, { mode: 'live' })]));
    render(<AiTradePanel />);
    await waitFor(() => expect(net.ai.map(c => c.url)).toEqual(['/api/ai/trades/claim?id=t1', '/api/ai/trades/result?id=t1']));
    expect(net.ai[0].body).toEqual({ decidedBy: 'auto' });
    expect(net.exchangeCalls().map(c => c.action)).toEqual([{ type: 'cancel', cancels: [{ a: 0, o: 7 }] }]);
  });

  it('live: auto-run sends a new order without a click', async () => {
    const net = stubNet(b => (b.action.type === 'order'
      ? { status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 43 } }] } } }
      : { status: 'ok', response: { type: 'default' } }));
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    useSettingsStore.setState({ mode: 'live' });
    useAiTradeStore.setState({ autoConfirm: true });
    act(() => useAiTradeStore.getState().receive([proposal(
      { kind: 'order', coin: 'BTC', side: 'sell', orderType: 'limit', price: 61000, size: 0.002 }, { mode: 'live' },
    )]));
    render(<AiTradePanel />);
    await waitFor(() => expect(net.ai.map(c => c.url)).toEqual(['/api/ai/trades/claim?id=t1', '/api/ai/trades/result?id=t1']));
    expect(net.ai[1].body).toEqual({ ok: true, message: 'resting #43' });
  });

  it('with auto-run off, nothing is sent until Confirm', async () => {
    const net = stubNet();
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    useSettingsStore.setState({ mode: 'live' });
    useLiveAccountStore.setState({ openOrders: [liveOrder({ oid: 8, isTrigger: true, orderType: 'Stop Market', triggerPx: '58000', reduceOnly: true })] });
    act(() => useAiTradeStore.getState().receive([proposal({ kind: 'cancel', coin: 'BTC', oids: [8] }, { mode: 'live' })]));
    render(<AiTradePanel />);
    expect(await screen.findByText(/position loses that protection/)).toBeInTheDocument();
    await act(() => new Promise(r => setTimeout(r, 20)));
    expect(net.ai).toHaveLength(0);
    expect(net.exchangeCalls()).toHaveLength(0);
  });

  it('auto-run defaults on and remembers being turned off', () => {
    localStorage.clear();
    act(() => useAiTradeStore.getState().setAutoConfirm(false));
    expect(localStorage.getItem('hl-ai-trade-autorun')).toBe('0');
    act(() => useAiTradeStore.getState().receive([proposal({ kind: 'close', coin: 'BTC' }, { status: 'done', decidedAt: Date.now() })]));
    render(<AiTradePanel />);
    expect(screen.getByLabelText("Run Claude's trades without confirming")).not.toBeChecked();
  });

  it('lists finished proposals with their outcome', () => {
    act(() => useAiTradeStore.getState().receive([proposal(
      { kind: 'close', coin: 'BTC' },
      { status: 'done', decidedAt: Date.now(), decidedBy: 'auto', result: { ok: true, message: 'closed' } },
    )]));
    render(<AiTradePanel />);
    expect(screen.getByTestId('ai-trade-row')).toHaveTextContent('done (auto)Market close BTC position');
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByTestId('ai-trade-row')).toBeNull();
  });
});

describe('previewTrade', () => {
  beforeEach(() => {
    stubNet();
    // Paper long 0.1 BTC from 60000.
    engine.placeOrder({ coin: 'BTC', side: 'buy', price: '60000', size: '0.1', reduceOnly: false, orderType: { limit: { tif: 'Ioc' } } });
    engine.onPriceUpdate('BTC', '60000');
  });

  it('rejects a stop on the wrong side of the mid', async () => {
    await expect(previewTrade(proposal({ kind: 'tpsl', coin: 'BTC', tpsl: 'sl', price: 61000 }))).rejects.toThrow(/wrong side of 60000 for a long/);
  });

  it('describes a close of the open position', async () => {
    expect((await previewTrade(proposal({ kind: 'close', coin: 'BTC' }))).lines).toEqual(['Market close BTC long 0.1 (mid 60000)']);
  });
});

describe('executeTrade in paper', () => {
  beforeEach(() => { stubNet(); });

  it('moving an entry cancels the old one with its linked TP/SL and rounds size to the lot', async () => {
    const first = await executeTrade(proposal({ kind: 'order', coin: 'BTC', side: 'buy', orderType: 'limit', price: 59000, sizeUsd: 100, sl: 58000, tp: 61000 }));
    expect(first.ok).toBe(true);
    const entry = useAccountStore.getState().paperOrders.find(o => o.type === 'limit')!;
    expect(entry.size.toString()).toBe('0.00169'); // 100 / 59000 rounded down to BTC's 5 decimals

    const moved = await executeTrade(proposal({ kind: 'order', coin: 'BTC', side: 'buy', orderType: 'limit', price: 58800, sizeUsd: 100, sl: 58000, replaceOid: entry.id }));
    expect(moved.message).toMatch(/cancel #paper-ord-\d+: cancelled \(and its TP\/SL #paper-ord-\d+, #paper-ord-\d+\)/);
    expect(useAccountStore.getState().paperOrders.map(o => [o.type, o.tpsl ?? null, o.price.toNumber()])).toEqual([
      ['limit', null, 58800], ['trigger', 'sl', 58000],
    ]);
  });

  it('cancelling an entry by oid also cancels its TP and SL', async () => {
    await executeTrade(proposal({ kind: 'order', coin: 'BTC', side: 'buy', orderType: 'limit', price: 59000, size: 0.01, sl: 58000, tp: 61000 }));
    await executeTrade(proposal({ kind: 'order', coin: 'BTC', side: 'buy', orderType: 'limit', price: 58500, size: 0.01, sl: 57500, tp: 60500 }));
    const [a, aTp, aSl, ...keep] = useAccountStore.getState().paperOrders.map(o => o.id);
    const r = await executeTrade(proposal({ kind: 'cancel', coin: 'BTC', oids: [a] }));
    expect(r).toEqual({ ok: true, message: `Cancelled 1 order (and TP/SL #${aTp}, #${aSl})` });
    expect(useAccountStore.getState().paperOrders.map(o => o.id)).toEqual(keep);

    const all = await executeTrade(proposal({ kind: 'cancel', coin: 'BTC', oids: 'all' }));
    expect(all).toEqual({ ok: true, message: 'Cancelled 3 orders' });
    expect(useAccountStore.getState().paperOrders).toEqual([]);
  });
});

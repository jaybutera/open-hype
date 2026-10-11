// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Wallet, TypedDataEncoder, recoverAddress, Signature } from 'ethers';
import { useMarketStore } from '../../../store/useMarketStore.ts';
import { useWalletStore } from '../../../store/useWalletStore.ts';
import { useLiveAccountStore } from '../../../store/useLiveAccountStore.ts';
import { actionHash } from '../signing.ts';
import {
  prepareOrder, placeLiveOrder, cancelLiveOrders, closeLivePosition, placeLivePositionTrigger,
} from '../liveTrader.ts';
import { stubHyperliquidFetch, META, XYZ_META } from '../../../test/hlMocks.ts';
import type { Meta } from '../../../types/market.ts';

const agent = new Wallet('0x' + '33'.repeat(32));
const master = '0x' + '44'.repeat(20);

/** Recover the L1 signer exactly as the exchange does (mainnet phantom agent). */
function recoverL1(req: { action: unknown; nonce: number; signature: { r: string; s: string; v: number } }) {
  const digest = TypedDataEncoder.hash(
    { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
    { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    { source: 'a', connectionId: actionHash(req.action, req.nonce) },
  );
  return recoverAddress(digest, Signature.from(req.signature));
}

const ok = (statuses: unknown[]) => ({ status: 'ok', response: { type: 'order', data: { statuses } } });

beforeEach(() => {
  useMarketStore.setState({
    meta: META as unknown as Meta, xyzMeta: XYZ_META as unknown as Meta,
    allMids: { BTC: '60000', ETH: '3000', 'xyz:TSLA': '250' },
  });
  useLiveAccountStore.getState().reset();
  useWalletStore.getState().disconnect();
  useWalletStore.getState().connectApiKey(agent.privateKey, master);
});
afterEach(() => vi.unstubAllGlobals());

describe('prepareOrder builds valid exchange wires', () => {
  it('limit order: lot-rounded size, tick-rounded price, GTC', async () => {
    const p = await prepareOrder({ coin: 'BTC', side: 'buy', size: '0.0012345', kind: 'limit', price: '59999.99', leverage: 5 });
    expect(p.wires).toEqual([{ a: 0, b: true, p: '60000', s: '0.00123', r: false, t: { limit: { tif: 'Gtc' } } }]);
    expect(p.grouping).toBe('na');
    expect(p.summary).toMatchObject({ coin: 'BTC', size: '0.00123', price: '60000', network: 'mainnet' });
  });

  it('market order: IOC capped 5% through mid', async () => {
    const buy = await prepareOrder({ coin: 'ETH', side: 'buy', size: '0.01', kind: 'market' });
    expect(buy.wires[0]).toMatchObject({ a: 1, p: '3150', t: { limit: { tif: 'Ioc' } } });
    const sell = await prepareOrder({ coin: 'ETH', side: 'sell', size: '0.01', kind: 'market' });
    expect(sell.wires[0].p).toBe('2850');
  });

  it('bracket: entry + reduce-only market TP/SL grouped normalTpsl', async () => {
    const p = await prepareOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'limit', price: 60000, tp: 63000, sl: 58000 });
    expect(p.grouping).toBe('normalTpsl');
    expect(p.wires.slice(1)).toEqual([
      { a: 0, b: false, p: '56700', s: '0.001', r: true, t: { trigger: { isMarket: true, triggerPx: '63000', tpsl: 'tp' } } },
      { a: 0, b: false, p: '52200', s: '0.001', r: true, t: { trigger: { isMarket: true, triggerPx: '58000', tpsl: 'sl' } } },
    ]);
  });

  it('HIP-3 asset ids come from perpDexs', async () => {
    stubHyperliquidFetch();
    const p = await prepareOrder({ coin: 'xyz:TSLA', side: 'sell', size: '0.1234', kind: 'limit', price: '250.123' });
    expect(p.wires[0]).toMatchObject({ a: 110001, s: '0.123', p: '250.12' });
  });

  it('rejects before signing: below $10, TP/SL on wrong side, unknown or delisted asset, no price', async () => {
    await expect(prepareOrder({ coin: 'BTC', side: 'buy', size: '0.0001', kind: 'limit', price: 60000 })).rejects.toThrow(/below .*\$10 minimum/);
    await expect(prepareOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'limit', price: 60000, tp: 59000 })).rejects.toThrow(/TP .* wrong side/);
    await expect(prepareOrder({ coin: 'BTC', side: 'sell', size: '0.001', kind: 'limit', price: 60000, sl: 59000 })).rejects.toThrow(/SL .* wrong side/);
    await expect(prepareOrder({ coin: 'NOPE', side: 'buy', size: 1, kind: 'market' })).rejects.toThrow(/not tradable/);
    await expect(prepareOrder({ coin: 'HPOS', side: 'buy', size: 100, kind: 'limit', price: 1 })).rejects.toThrow(/delisted/);
    await expect(prepareOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'limit' })).rejects.toThrow(/Limit price required/);
    // Reduce-only closes may be below the minimum.
    await expect(prepareOrder({ coin: 'BTC', side: 'sell', size: '0.0001', kind: 'market', reduceOnly: true })).resolves.toBeTruthy();
  });
});

describe('order lifecycle against a stubbed exchange', () => {
  it('sets leverage, then sends a signed order; signer recovers to the agent', async () => {
    const net = stubHyperliquidFetch({
      exchange: b => (b.action.type === 'order' ? ok([{ resting: { oid: 571364614362 } }]) : { status: 'ok', response: { type: 'default' } }),
    });
    const r = await placeLiveOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'limit', price: 60000, leverage: 7 });
    expect(r).toMatchObject({ ok: true, message: 'resting #571364614362' });

    const [lev, order] = net.exchangeCalls();
    expect(lev.action).toEqual({ type: 'updateLeverage', asset: 0, isCross: true, leverage: 7 });
    expect(order.action).toEqual({ type: 'order', orders: [{ a: 0, b: true, p: '60000', s: '0.001', r: false, t: { limit: { tif: 'Gtc' } } }], grouping: 'na' });
    expect(order.nonce).toBeGreaterThan(lev.nonce);
    expect(recoverL1(lev)).toBe(agent.address);
    expect(recoverL1(order)).toBe(agent.address);

    // Same leverage again: no second updateLeverage.
    await placeLiveOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'limit', price: 60000, leverage: 7 });
    expect(net.exchangeCalls().map(c => c.action.type)).toEqual(['updateLeverage', 'order', 'order']);
  });

  it('isolated-only assets get isolated leverage', async () => {
    const net = stubHyperliquidFetch({ exchange: b => (b.action.type === 'order' ? ok([{ resting: { oid: 1 } }]) : { status: 'ok', response: { type: 'default' } }) });
    await placeLiveOrder({ coin: 'xyz:TSLA', side: 'buy', size: '0.1', kind: 'limit', price: 250, leverage: 50 });
    expect(net.exchangeCalls()[0].action).toEqual({ type: 'updateLeverage', asset: 110001, isCross: false, leverage: 10 });
  });

  it('reports fills and per-order rejections', async () => {
    stubHyperliquidFetch({ exchange: () => ok([{ filled: { totalSz: '0.001', avgPx: '60010.5', oid: 9 } }, 'waitingForFill', { error: 'Order must have minimum value of $10.' }]) });
    const r = await placeLiveOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'market', tp: 70000, sl: 50000 });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('filled 0.001 @ 60010.5 | waitingForFill | rejected: Order must have minimum value of $10.');
  });

  it('request-level rejection from an unapproved signer disables trading', async () => {
    stubHyperliquidFetch({ exchange: () => ({ status: 'err', response: `User or API Wallet ${agent.address.toLowerCase()} does not exist.` }) });
    const r = await placeLiveOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'limit', price: 60000 });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/does not exist/) });
    expect(useWalletStore.getState().error).toMatch(/not approved/);
  });

  it('HTTP errors and non-JSON bodies are reported, not swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })));
    const r = await placeLiveOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'limit', price: 60000 });
    expect(r).toEqual({ ok: false, message: 'HTTP 429: rate limited' });
  });

  it('refuses to sign when trading is not enabled', async () => {
    const net = stubHyperliquidFetch();
    useWalletStore.getState().disconnect();
    const r = await placeLiveOrder({ coin: 'BTC', side: 'buy', size: '0.001', kind: 'limit', price: 60000 });
    expect(r).toEqual({ ok: false, message: 'Connect a wallet and enable trading first' });
    expect(net.exchangeCalls()).toHaveLength(0);
  });
});

describe('position management', () => {
  beforeEach(() => {
    useLiveAccountStore.setState({
      user: master,
      positions: [{ coin: 'BTC', szi: -0.03992, entryPx: 61000, positionValue: 2400, unrealizedPnl: 5, returnOnEquity: 0, liquidationPx: 70000, marginUsed: 200, leverage: { type: 'isolated', value: 10 } }],
    });
  });

  it('market close is reduce-only, sized to the position, opposite side', async () => {
    const net = stubHyperliquidFetch({ exchange: () => ok([{ filled: { totalSz: '0.03992', avgPx: '60000', oid: 5 } }]) });
    expect((await closeLivePosition('BTC')).ok).toBe(true);
    expect(net.exchangeCalls()[0].action.orders).toEqual([{ a: 0, b: true, p: '63000', s: '0.03992', r: true, t: { limit: { tif: 'Ioc' } } }]);
  });

  it('position TP closes the full size', async () => {
    const net = stubHyperliquidFetch({ exchange: () => ok(['waitingForTrigger']) });
    await placeLivePositionTrigger('BTC', 'tp', 55000);
    expect(net.exchangeCalls()[0].action.orders[0]).toEqual(
      { a: 0, b: true, p: '60500', s: '0.03992', r: true, t: { trigger: { isMarket: true, triggerPx: '55000', tpsl: 'tp' } } });
  });

  it('cancel maps coin to asset id and reports per-order failures', async () => {
    const net = stubHyperliquidFetch({ exchange: () => ({ status: 'ok', response: { type: 'cancel', data: { statuses: ['success', { error: 'Order was never placed, already canceled, or filled.' }] } } }) });
    const r = await cancelLiveOrders([{ coin: 'BTC', oid: 571364614362 }, { coin: 'xyz:TSLA', oid: 2 }]);
    expect(net.exchangeCalls()[0].action).toEqual({ type: 'cancel', cancels: [{ a: 0, o: 571364614362 }, { a: 110001, o: 2 }] });
    expect(r).toEqual({ ok: false, message: 'Order was never placed, already canceled, or filled.' });
  });
});

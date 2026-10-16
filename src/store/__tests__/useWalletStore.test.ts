// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Wallet, TypedDataEncoder, recoverAddress, Signature } from 'ethers';
import { useWalletStore, normalizePrivateKey, AGENT_NAME } from '../useWalletStore.ts';
import { APPROVE_AGENT_TYPES, userSignedDomain } from '../../services/hl/signing.ts';
import { MockWalletProvider, stubHyperliquidFetch } from '../../test/hlMocks.ts';

const user = new Wallet('0x' + '11'.repeat(32));
const user2 = new Wallet('0x' + '22'.repeat(32));
let provider: MockWalletProvider;

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  provider = new MockWalletProvider([user]);
  (window as any).ethereum = provider;
  useWalletStore.getState().disconnect();
});
afterEach(() => {
  delete (window as any).ethereum;
  vi.unstubAllGlobals();
});

describe('browser wallet connection', () => {
  it('connects through the injected provider without enabling trading', async () => {
    stubHyperliquidFetch();
    await useWalletStore.getState().connectBrowser('injected');
    const s = useWalletStore.getState();
    expect(s.status).toBe('connected');
    expect(s.address).toBe(user.address);
    expect(s.chainId).toBe(42161);
    expect(s.tradingStatus).toBe('none');
    expect(s.agent).toBeNull();
  });

  it('surfaces a rejected connection request instead of failing silently', async () => {
    provider.rejectNext = { code: 4001, message: 'User rejected the request.' };
    await useWalletStore.getState().connectBrowser('injected');
    expect(useWalletStore.getState()).toMatchObject({ status: 'disconnected', error: 'Request rejected in wallet' });
  });

  it('opens the account picker on connect, then reads the picked account', async () => {
    stubHyperliquidFetch();
    provider.accounts = [user, user2];
    provider.authorised = true; // site already authorised for `user`
    provider.pick = [user2];
    await useWalletStore.getState().connectBrowser('injected');
    expect(provider.calls.slice(0, 2)).toEqual(['wallet_requestPermissions', 'eth_accounts']);
    expect(provider.calls).not.toContain('eth_requestAccounts');
    expect(useWalletStore.getState().address).toBe(user2.address);
  });

  it.each([
    { code: -32601, message: 'Method not found' },
    { code: 4200, message: 'Unsupported method' },
    { message: 'The method "wallet_requestPermissions" does not exist / is not available.' },
  ])('falls back to eth_requestAccounts when the wallet lacks wallet_requestPermissions ($message)', async (err) => {
    stubHyperliquidFetch();
    provider.permissionsError = err;
    await useWalletStore.getState().connectBrowser('injected');
    expect(provider.calls.slice(0, 2)).toEqual(['wallet_requestPermissions', 'eth_requestAccounts']);
    expect(useWalletStore.getState()).toMatchObject({ status: 'connected', address: user.address, error: null });
  });

  it('a rejected account picker surfaces as a rejection, not a fallback', async () => {
    provider.permissionsError = { code: 4001, message: 'User rejected the request.' };
    await useWalletStore.getState().connectBrowser('injected');
    expect(useWalletStore.getState()).toMatchObject({ status: 'disconnected', error: 'Request rejected in wallet' });
    expect(provider.calls).not.toContain('eth_requestAccounts');
  });

  it('switch account re-opens the picker; cancelling keeps the current session', async () => {
    stubHyperliquidFetch();
    provider.accounts = [user, user2];
    await useWalletStore.getState().connectBrowser('injected');
    expect(useWalletStore.getState().address).toBe(user.address);

    provider.rejectNext = { code: 4001, message: 'User rejected the request.' };
    await useWalletStore.getState().connectBrowser('injected');
    expect(useWalletStore.getState()).toMatchObject({ status: 'connected', address: user.address, error: 'Request rejected in wallet' });

    provider.pick = [user2];
    await useWalletStore.getState().connectBrowser('injected');
    expect(useWalletStore.getState()).toMatchObject({ status: 'connected', address: user2.address, error: null });
  });

  it('restore() never opens a prompt', async () => {
    localStorage.setItem('hl-last-wallet', 'injected');
    await useWalletStore.getState().restore();
    expect(provider.calls).toEqual(['eth_accounts']);
  });

  it('reports a missing wallet', async () => {
    delete (window as any).ethereum;
    await useWalletStore.getState().connectBrowser('injected');
    expect(useWalletStore.getState().error).toMatch(/Wallet not found/);
  });

  it('restore() reconnects silently only if the site is already authorised', async () => {
    stubHyperliquidFetch();
    localStorage.setItem('hl-last-wallet', 'injected');
    await useWalletStore.getState().restore();
    expect(useWalletStore.getState().status).toBe('disconnected');
    provider.authorised = true;
    await useWalletStore.getState().restore();
    expect(useWalletStore.getState().address).toBe(user.address);
  });
});

describe('enable trading (ApproveAgent)', () => {
  it('has the wallet sign ApproveAgent for a fresh agent and submits it', async () => {
    const net = stubHyperliquidFetch({ exchange: () => ({ status: 'ok', response: { type: 'default' } }) });
    await useWalletStore.getState().connectBrowser('injected');
    await useWalletStore.getState().enableTrading();

    const s = useWalletStore.getState();
    expect(s.error).toBeNull();
    expect(s.tradingStatus).toBe('ready');
    expect(s.agent).not.toBeNull();
    expect(s.agent!.address).not.toBe(user.address);

    const [req] = net.exchangeCalls();
    expect(req.action).toEqual({
      type: 'approveAgent', hyperliquidChain: 'Mainnet', signatureChainId: '0xa4b1',
      agentAddress: s.agent!.address, agentName: AGENT_NAME, nonce: req.nonce,
    });
    // The signature is the user's, over the domain chain the wallet is on.
    const digest = TypedDataEncoder.hash(userSignedDomain(42161), APPROVE_AGENT_TYPES, {
      hyperliquidChain: 'Mainnet', agentAddress: s.agent!.address, agentName: AGENT_NAME, nonce: req.nonce,
    });
    expect(recoverAddress(digest, Signature.from(req.signature))).toBe(user.address);

    // Agent persisted for this account and network only.
    const stored = JSON.parse(localStorage.getItem(`hl-agent:mainnet:${user.address.toLowerCase()}`)!);
    expect(stored.address).toBe(s.agent!.address);
  });

  it('keeps trading disabled when the user rejects the signature', async () => {
    const net = stubHyperliquidFetch();
    await useWalletStore.getState().connectBrowser('injected');
    provider.rejectNext = { code: 4001, message: 'User denied message signature.' };
    await useWalletStore.getState().enableTrading();
    expect(useWalletStore.getState()).toMatchObject({ tradingStatus: 'none', error: 'Request rejected in wallet', agent: null });
    expect(net.exchangeCalls()).toHaveLength(0);
  });

  it('shows the exchange rejection and stores nothing', async () => {
    stubHyperliquidFetch({ exchange: () => ({ status: 'err', response: 'Must deposit before performing actions. User: 0xabc' }) });
    await useWalletStore.getState().connectBrowser('injected');
    await useWalletStore.getState().enableTrading();
    const s = useWalletStore.getState();
    expect(s.tradingStatus).toBe('none');
    expect(s.error).toMatch(/Hyperliquid rejected approval: Must deposit/);
    expect(Object.keys(localStorage).filter(k => k.startsWith('hl-agent:'))).toEqual([]);
  });

  it('drops a stored agent that Hyperliquid no longer lists', async () => {
    stubHyperliquidFetch({ exchange: () => ({ status: 'ok', response: { type: 'default' } }) });
    await useWalletStore.getState().connectBrowser('injected');
    await useWalletStore.getState().enableTrading();
    const agent = useWalletStore.getState().agent!.address;

    // Same account reconnects later; extraAgents now lists a different agent.
    stubHyperliquidFetch({ info: b => (b.type === 'extraAgents' ? [{ address: '0x' + '9'.repeat(40), name: 'x' }] : undefined) });
    provider.emit('accountsChanged', [user2.address]);
    await flush();
    provider.emit('accountsChanged', [user.address]);
    await flush(); await flush();
    expect(useWalletStore.getState().tradingStatus).toBe('none');
    expect(useWalletStore.getState().error).toMatch(/no longer approved/);
    expect(localStorage.getItem(`hl-agent:mainnet:${user.address.toLowerCase()}`)).toBeNull();
    expect(agent).toBeTruthy();
  });
});

describe('wallet events', () => {
  it('follows account switches with per-account agents, chain changes, and lock', async () => {
    stubHyperliquidFetch({
      exchange: () => ({ status: 'ok', response: { type: 'default' } }),
      info: b => (b.type === 'extraAgents' ? [{ address: useWalletStore.getState().agent?.address ?? '', name: AGENT_NAME }] : undefined),
    });
    provider.accounts = [user, user2];
    await useWalletStore.getState().connectBrowser('injected');
    await useWalletStore.getState().enableTrading();
    const agent1 = useWalletStore.getState().agent!.address;

    provider.emit('accountsChanged', [user2.address]);
    await flush();
    expect(useWalletStore.getState()).toMatchObject({ address: user2.address, tradingStatus: 'none', agent: null });

    provider.emit('chainChanged', '0x1');
    expect(useWalletStore.getState().chainId).toBe(1);

    provider.emit('accountsChanged', [user.address]);
    await flush(); await flush();
    expect(useWalletStore.getState().agent?.address).toBe(agent1);

    // Wallet locked: session ends, but the stored agent survives for next time.
    provider.emit('accountsChanged', []);
    expect(useWalletStore.getState().status).toBe('disconnected');
    expect(localStorage.getItem(`hl-agent:mainnet:${user.address.toLowerCase()}`)).not.toBeNull();
  });

  it('explicit disconnect forgets the agent and stops listening', async () => {
    stubHyperliquidFetch({ exchange: () => ({ status: 'ok', response: { type: 'default' } }) });
    await useWalletStore.getState().connectBrowser('injected');
    await useWalletStore.getState().enableTrading();
    useWalletStore.getState().disconnect();
    expect(useWalletStore.getState()).toMatchObject({ status: 'disconnected', address: null, agent: null });
    expect(localStorage.getItem(`hl-agent:mainnet:${user.address.toLowerCase()}`)).toBeNull();
    expect(provider.listeners.get('accountsChanged')?.size ?? 0).toBe(0);
  });
});

describe('API wallet key', () => {
  const key = '0x' + 'ab'.repeat(32);

  it('accepts keys with whitespace or without 0x (both used to fail silently)', () => {
    expect(normalizePrivateKey(`  ${key}\n`)).toBe(key);
    expect(normalizePrivateKey(key.slice(2))).toBe(key);
    expect(normalizePrivateKey(key.toUpperCase().replace('0X', ''))).toBe(key);
  });

  it('refuses seed phrases and malformed keys with a message', () => {
    expect(() => normalizePrivateKey('test test test test test test test test test test test junk')).toThrow(/seed phrase/);
    expect(() => normalizePrivateKey('0x1234')).toThrow(/64 hex/);
    useWalletStore.getState().connectApiKey('nope');
    expect(useWalletStore.getState()).toMatchObject({ status: 'disconnected', error: expect.stringMatching(/64 hex/) });
  });

  it('uses the key as signer and the given account for balances', () => {
    useWalletStore.getState().connectApiKey(key.slice(2), user.address.toLowerCase());
    const s = useWalletStore.getState();
    expect(s).toMatchObject({ status: 'connected', source: 'apiKey', address: user.address, tradingStatus: 'ready' });
    expect(s.agent!.address).toBe(new Wallet(key).address);
    expect(localStorage.length).toBe(0);
  });

  it('defaults the account to the key address', () => {
    useWalletStore.getState().connectApiKey(key);
    expect(useWalletStore.getState().address).toBe(new Wallet(key).address);
  });
});

describe('sub-accounts', () => {
  const subA = new Wallet('0x' + 'a1'.repeat(32)).address;
  const subB = new Wallet('0x' + 'b2'.repeat(32)).address;
  const subsOf = (master: string) => (master.toLowerCase() === user.address.toLowerCase() ? [
    { name: 'Alpha', subAccountUser: subA.toLowerCase(), master, clearinghouseState: { marginSummary: { accountValue: '123.45' } } },
    { name: 'Beta', subAccountUser: subB.toLowerCase(), master, clearinghouseState: { marginSummary: { accountValue: '0.0' } } },
  ] : null);
  const stub = () => stubHyperliquidFetch({
    info: b => (b.type === 'subAccounts' ? subsOf(b.user)
      : b.type === 'clearinghouseState' && b.user === user.address ? { marginSummary: { accountValue: '1000.5', totalMarginUsed: '0' }, withdrawable: '0', assetPositions: [] }
      : undefined),
  });

  it('loads sub-accounts on connect with balances; master stays selected by default', async () => {
    stub();
    await useWalletStore.getState().connectBrowser('injected');
    await flush();
    const s = useWalletStore.getState();
    expect(s.subAccounts).toEqual([
      { name: 'Alpha', address: subA, accountValue: 123.45 },
      { name: 'Beta', address: subB, accountValue: 0 },
    ]);
    expect(s.masterValue).toBe(1000.5);
    expect(s.subAccount).toBeNull();
  });

  it('remembers the selected sub-account per master across reconnects', async () => {
    stub();
    await useWalletStore.getState().connectBrowser('injected');
    await flush();
    useWalletStore.getState().selectAccount(subB);
    expect(useWalletStore.getState().subAccount).toBe(subB);
    expect(localStorage.getItem(`hl-subaccount:mainnet:${user.address.toLowerCase()}`)).toBe(subB.toLowerCase());

    useWalletStore.setState({ status: 'disconnected', address: null, subAccount: null, subAccounts: [] });
    await useWalletStore.getState().connectBrowser('injected');
    await flush();
    expect(useWalletStore.getState().subAccount).toBe(subB);

    useWalletStore.getState().selectAccount(null);
    expect(useWalletStore.getState().subAccount).toBeNull();
    expect(localStorage.getItem(`hl-subaccount:mainnet:${user.address.toLowerCase()}`)).toBeNull();
  });

  it('account values include spot balances, so idle unified accounts are not $0', async () => {
    stubHyperliquidFetch({
      info: b => (b.type === 'subAccounts' ? [{
        name: 'daybias', subAccountUser: subA.toLowerCase(), master: user.address,
        clearinghouseState: { marginSummary: { accountValue: '0.0' } },
        spotState: { balances: [{ coin: 'USDC', token: 0, total: '1721.084653', hold: '0.0' }] },
      }]
        : b.type === 'clearinghouseState' ? { marginSummary: { accountValue: '0.0', totalMarginUsed: '0' }, withdrawable: '0', assetPositions: [] }
        : b.type === 'spotClearinghouseState' ? { balances: [{ coin: 'USDC', token: 0, total: '260.896634', hold: '0.0' }] }
        : undefined),
    });
    await useWalletStore.getState().connectBrowser('injected');
    await flush();
    const s = useWalletStore.getState();
    expect(s.masterValue).toBeCloseTo(260.896634, 6);
    expect(s.subAccounts[0].accountValue).toBeCloseTo(1721.084653, 6);
  });

  it('ignores addresses that are not sub-accounts of this master', async () => {
    stub();
    await useWalletStore.getState().connectBrowser('injected');
    await flush();
    useWalletStore.getState().selectAccount(user2.address);
    expect(useWalletStore.getState().subAccount).toBeNull();
  });

  it('switching wallet account clears the sub-account selection', async () => {
    stub();
    provider.accounts = [user, user2];
    await useWalletStore.getState().connectBrowser('injected');
    await flush();
    useWalletStore.getState().selectAccount(subA);
    provider.emit('accountsChanged', [user2.address]);
    await flush();
    expect(useWalletStore.getState()).toMatchObject({ address: user2.address, subAccount: null, subAccounts: [] });
  });
});

import { create } from 'zustand';
import { Wallet, getAddress, isAddress } from 'ethers';
import { API_BASE } from '../config/constants.ts';
import { IS_MAINNET, NETWORK } from '../services/hl/network.ts';
import { postInfo } from '../services/api/client.ts';
import { loadAbstraction, spotCarriesPerpEquity, valueSpot, type RawSpotBalance, type RawSpotState } from '../services/hl/balances.ts';
import { approveAgentTypedData, recoverApproveAgentSigner, splitSignature } from '../services/hl/signing.ts';
import { submitApproveAgent, ExchangeError } from '../services/hl/exchange.ts';
import {
  findWallet, pickAccounts, existingAccounts, chainIdOf, signTypedDataV4,
  describeWalletError, type Eip1193Provider,
} from '../services/wallet/eip1193.ts';

/**
 * Wallet connection and trading authority.
 *
 * - "browser": the user's own wallet (MetaMask, Rabby...) identifies the account.
 *   Trading is enabled by generating a local agent key and having the wallet
 *   sign Hyperliquid's ApproveAgent message. The agent can trade but cannot
 *   withdraw or transfer funds.
 * - "apiKey": the user pastes an API wallet key created at app.hyperliquid.xyz/API.
 *   It is held in memory only and dropped on reload or disconnect.
 */

export type WalletSource = 'browser' | 'apiKey';
export type TradingStatus = 'none' | 'approving' | 'ready';

export const AGENT_NAME = 'OpenHype';
const LAST_WALLET_KEY = 'hl-last-wallet';
const agentKey = (master: string) => `hl-agent:${NETWORK}:${master.toLowerCase()}`;
const subAccountKey = (master: string) => `hl-subaccount:${NETWORK}:${master.toLowerCase()}`;

export interface SubAccount { name: string; address: string; accountValue: number }

interface RawSubAccount {
  name: string;
  subAccountUser: string;
  clearinghouseState?: { marginSummary?: { accountValue?: string } };
  spotState?: { balances?: RawSpotBalance[] };
}

/**
 * Perp account value plus spot holdings; unified accounts keep idle USDC in spot.
 * `spotHasPerpEquity`: the spot balances come from spotClearinghouseState of a unified or
 * portfolio-margin account, where they already include perp equity, so perps are not added.
 * The `spotState` embedded in `subAccounts` rows does not: for a unified sub with an open
 * position it reports USDC 0 while perp accountValue holds the equity, so those rows add up.
 */
async function totalValue(
  perp: RawSubAccount['clearinghouseState'] | null, spot: RawSpotBalance[] | undefined, spotHasPerpEquity = false,
): Promise<number | null> {
  const pv = perp?.marginSummary?.accountValue;
  if (pv == null && !spot) return null;
  const sv = spot ? await valueSpot(spot) : 0;
  return spotHasPerpEquity && spot ? sv : parseFloat(pv ?? '0') + sv;
}

function loadSelectedSub(master: string): string | null {
  try { return localStorage.getItem(subAccountKey(master)); } catch { return null; }
}

function saveSelectedSub(master: string, sub: string | null) {
  try {
    if (sub) localStorage.setItem(subAccountKey(master), sub.toLowerCase());
    else localStorage.removeItem(subAccountKey(master));
  } catch {}
}

interface StoredAgent { key: string; address: string; approvedAt: number }

function loadAgent(master: string): Wallet | null {
  try {
    const raw = localStorage.getItem(agentKey(master));
    if (!raw) return null;
    const a = JSON.parse(raw) as StoredAgent;
    const w = new Wallet(a.key);
    return w.address === a.address ? w : null;
  } catch { return null; }
}

function saveAgent(master: string, agent: Wallet) {
  try {
    localStorage.setItem(agentKey(master), JSON.stringify({ key: agent.privateKey, address: agent.address, approvedAt: Date.now() } satisfies StoredAgent));
  } catch {}
}

function dropAgent(master: string) {
  try { localStorage.removeItem(agentKey(master)); } catch {}
}

/** Fresh agent key from the browser CSPRNG. Never reused: the docs warn a pruned agent's old signatures can replay. */
function newAgentKey(): Wallet {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return new Wallet('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''));
}

/** Is `agent` still an approved agent of `master`? Network errors count as "unknown" (true). */
async function agentStillApproved(master: string, agent: string): Promise<boolean> {
  try {
    const list = await postInfo<{ address: string; name: string }[]>({ type: 'extraAgents', user: master });
    return list.some(a => a.address.toLowerCase() === agent.toLowerCase());
  } catch { return true; }
}

/**
 * Normalise a pasted private key. Wallet exports often omit "0x" and copy/paste
 * adds whitespace; both used to fail silently.
 */
export function normalizePrivateKey(raw: string): string {
  const k = raw.trim().replace(/\s+/g, '');
  if (/\s/.test(raw.trim()) && raw.trim().split(/\s+/).length >= 12) {
    throw new Error('That looks like a seed phrase. Never paste a seed phrase into any website; use an API wallet key instead.');
  }
  const hex = k.startsWith('0x') || k.startsWith('0X') ? k.slice(2) : k;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Key must be 64 hex characters (with or without 0x)');
  return '0x' + hex.toLowerCase();
}

interface WalletStore {
  status: 'disconnected' | 'connecting' | 'connected';
  source: WalletSource | null;
  /** Master account address: owns the agent approval and any sub-accounts. */
  address: string | null;
  /** Sub-accounts of the master, from the `subAccounts` info request. */
  subAccounts: SubAccount[];
  /** Selected sub-account address, or null to trade the master account. */
  subAccount: string | null;
  /** Master account value (perps plus spot), for the account selector. */
  masterValue: number | null;
  walletId: string | null;
  walletName: string | null;
  chainId: number | null;
  provider: Eip1193Provider | null;
  /** Key that signs orders: the approved agent, or the pasted API wallet key. */
  agent: Wallet | null;
  tradingStatus: TradingStatus;
  error: string | null;

  connectBrowser: (walletId: string) => Promise<void>;
  connectApiKey: (key: string, masterAddress?: string) => void;
  restore: () => Promise<void>;
  enableTrading: () => Promise<void>;
  invalidateAgent: (reason: string) => void;
  loadSubAccounts: () => Promise<void>;
  selectAccount: (subAccount: string | null) => void;
  disconnect: () => void;
  clearError: () => void;
}

let detach: (() => void) | null = null;

export const useWalletStore = create<WalletStore>((set, get) => {
  const adoptAccount = async (master: string) => {
    const addr = getAddress(master);
    const agent = loadAgent(addr);
    set({ address: addr, subAccounts: [], subAccount: null, masterValue: null, agent, tradingStatus: agent ? 'ready' : 'none', error: null });
    void get().loadSubAccounts();
    if (agent && !(await agentStillApproved(addr, agent.address))) {
      if (get().address !== addr) return;
      dropAgent(addr);
      set({ agent: null, tradingStatus: 'none', error: 'Trading key is no longer approved on Hyperliquid; enable trading again' });
    }
  };

  /** Wallet locked or site access revoked: drop the session but keep the stored agent for later. */
  const softDisconnect = () => {
    detach?.();
    set({
      status: 'disconnected', source: null, address: null, walletId: null, walletName: null,
      chainId: null, provider: null, agent: null, tradingStatus: 'none', error: null,
      subAccounts: [], subAccount: null, masterValue: null,
    });
  };

  const attach = (p: Eip1193Provider) => {
    detach?.();
    const onAccounts = (accounts: string[]) => {
      if (!accounts?.length) { softDisconnect(); return; }
      if (get().address?.toLowerCase() !== accounts[0].toLowerCase()) void adoptAccount(accounts[0]);
    };
    const onChain = (id: string) => set({ chainId: Number(id) });
    p.on?.('accountsChanged', onAccounts);
    p.on?.('chainChanged', onChain);
    detach = () => {
      p.removeListener?.('accountsChanged', onAccounts);
      p.removeListener?.('chainChanged', onChain);
      detach = null;
    };
  };

  const connectWith = async (walletId: string, interactive: boolean) => {
    const w = findWallet(walletId);
    if (!w) {
      if (interactive) set({ error: 'Wallet not found. Install or unlock a browser wallet and reload.' });
      return;
    }
    // Switching account on a live browser session: keep it if the picker is cancelled.
    const prev = get();
    const keep = prev.status === 'connected' && prev.source === 'browser' && prev.walletId === w.id;
    set(keep ? { error: null } : { status: 'connecting', error: null });
    const fail = (error: string | null) => set(keep ? { error } : { status: 'disconnected', error });
    try {
      const accounts = interactive ? await pickAccounts(w.provider) : await existingAccounts(w.provider);
      if (!accounts.length) {
        fail(interactive ? 'Wallet returned no accounts' : null);
        return;
      }
      const chainId = await chainIdOf(w.provider).catch(() => null);
      set({ status: 'connected', source: 'browser', walletId: w.id, walletName: w.name, provider: w.provider, chainId });
      attach(w.provider);
      try { localStorage.setItem(LAST_WALLET_KEY, w.id); } catch {}
      await adoptAccount(accounts[0]);
    } catch (e) {
      fail(describeWalletError(e));
    }
  };

  return {
    status: 'disconnected',
    source: null,
    address: null,
    subAccounts: [],
    subAccount: null,
    masterValue: null,
    walletId: null,
    walletName: null,
    chainId: null,
    provider: null,
    agent: null,
    tradingStatus: 'none',
    error: null,

    connectBrowser: (walletId) => connectWith(walletId, true),

    connectApiKey: (key, masterAddress) => {
      try {
        const signer = new Wallet(normalizePrivateKey(key));
        const master = masterAddress?.trim();
        if (master && !isAddress(master)) throw new Error('Account address is not a valid 0x address');
        detach?.();
        set({
          status: 'connected', source: 'apiKey', walletId: null, walletName: 'API wallet', provider: null, chainId: null,
          address: master ? getAddress(master) : signer.address, agent: signer, tradingStatus: 'ready', error: null,
          subAccounts: [], subAccount: null, masterValue: null,
        });
        void get().loadSubAccounts();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

    /** Silent reconnect after a reload; never opens a wallet prompt. */
    restore: async () => {
      let id: string | null = null;
      try { id = localStorage.getItem(LAST_WALLET_KEY); } catch {}
      if (id && get().status === 'disconnected') await connectWith(id, false);
    },

    enableTrading: async () => {
      const { provider, address, source } = get();
      if (source !== 'browser' || !provider || !address) return;
      set({ tradingStatus: 'approving', error: null });
      try {
        const agent = newAgentKey();
        const chainId = await chainIdOf(provider);
        const msg = {
          hyperliquidChain: IS_MAINNET ? 'Mainnet' as const : 'Testnet' as const,
          agentAddress: agent.address,
          agentName: AGENT_NAME,
          nonce: Date.now(),
        };
        const sig = splitSignature(await signTypedDataV4(provider, address, approveAgentTypedData(msg, chainId)));
        if (recoverApproveAgentSigner(msg, chainId, sig).toLowerCase() !== address.toLowerCase()) {
          throw new Error('Wallet signed with a different account than the one connected');
        }
        await submitApproveAgent(API_BASE, msg, '0x' + chainId.toString(16), sig);
        if (get().address !== address) return;
        saveAgent(address, agent);
        set({ agent, tradingStatus: 'ready' });
      } catch (e) {
        const message = e instanceof ExchangeError ? `Hyperliquid rejected approval: ${e.message}` : describeWalletError(e);
        set({ tradingStatus: 'none', error: message });
      }
    },

    invalidateAgent: (reason) => {
      const { address, source } = get();
      if (source === 'browser' && address) {
        dropAgent(address);
        set({ agent: null, tradingStatus: 'none', error: reason });
      } else {
        set({ error: reason });
      }
    },

    loadSubAccounts: async () => {
      const master = get().address;
      if (!master) return;
      let raw: RawSubAccount[] | null;
      let masterState: RawSubAccount['clearinghouseState'] | null;
      let masterSpot: RawSpotState | null;
      let masterMode: string | null;
      try {
        [raw, masterState, masterSpot, masterMode] = await Promise.all([
          postInfo<RawSubAccount[] | null>({ type: 'subAccounts', user: master }),
          postInfo<RawSubAccount['clearinghouseState']>({ type: 'clearinghouseState', user: master }).catch(() => null),
          postInfo<RawSpotState>({ type: 'spotClearinghouseState', user: master }).catch(() => null),
          loadAbstraction(master),
        ]);
      } catch { return; }
      const subs = Array.isArray(raw) ? raw : [];
      const [masterValue, ...subValues] = await Promise.all([
        totalValue(masterState, masterSpot?.balances, spotCarriesPerpEquity(masterMode, masterSpot)),
        ...subs.map(r => totalValue(r.clearinghouseState ?? null, r.spotState?.balances)),
      ]);
      if (get().address !== master) return;
      const subAccounts = subs.map((r, i) => ({
        name: r.name,
        address: getAddress(r.subAccountUser),
        accountValue: subValues[i] ?? 0,
      }));
      // Keep the current pick, else restore the stored one if it still belongs to this master.
      const want = get().subAccount ?? loadSelectedSub(master);
      const picked = subAccounts.find(a => a.address.toLowerCase() === want?.toLowerCase());
      set({ subAccounts, subAccount: picked?.address ?? null, masterValue });
    },

    selectAccount: (sub) => {
      const { address, subAccounts } = get();
      if (!address) return;
      const picked = sub ? subAccounts.find(a => a.address.toLowerCase() === sub.toLowerCase()) : null;
      if (sub && !picked) return;
      saveSelectedSub(address, picked?.address ?? null);
      set({ subAccount: picked?.address ?? null });
    },

    /** Explicit disconnect also forgets the stored agent key; reconnecting asks for a fresh approval. */
    disconnect: () => {
      const { address, source } = get();
      if (source === 'browser' && address) dropAgent(address);
      detach?.();
      try { localStorage.removeItem(LAST_WALLET_KEY); } catch {}
      set({
        status: 'disconnected', source: null, address: null, walletId: null, walletName: null,
        chainId: null, provider: null, agent: null, tradingStatus: 'none', error: null,
        subAccounts: [], subAccount: null, masterValue: null,
      });
    },

    clearError: () => set({ error: null }),
  };
});

/** Account whose balances, positions and orders are shown and traded: the selected sub-account, else the master. */
export const selectActiveAccount = (s: Pick<WalletStore, 'address' | 'subAccount'>): string | null => s.subAccount ?? s.address;

import { vi } from 'vitest';
import { Wallet } from 'ethers';
import type { Eip1193Provider } from '../services/wallet/eip1193.ts';

/**
 * Test double for a browser wallet: answers EIP-1193 requests and signs typed
 * data with a real key, so signatures are genuine and recoverable.
 */
export class MockWalletProvider implements Eip1193Provider {
  listeners = new Map<string, Set<(...a: any[]) => void>>();
  authorised = false;
  rejectNext: { code: number; message: string } | null = null;
  signedTypedData: unknown[] = [];

  constructor(public accounts: Wallet[], public chainId = 42161) {}

  async request({ method, params }: { method: string; params?: unknown[] | object }): Promise<unknown> {
    if (this.rejectNext) {
      const e = this.rejectNext;
      this.rejectNext = null;
      throw Object.assign(new Error(e.message), { code: e.code });
    }
    switch (method) {
      case 'eth_requestAccounts': this.authorised = true; return this.accounts.map(a => a.address);
      case 'eth_accounts': return this.authorised ? this.accounts.map(a => a.address) : [];
      case 'eth_chainId': return '0x' + this.chainId.toString(16);
      case 'eth_signTypedData_v4': {
        const [addr, json] = params as [string, string];
        const signer = this.accounts.find(a => a.address.toLowerCase() === addr.toLowerCase());
        if (!signer) throw Object.assign(new Error('unknown account'), { code: 4100 });
        const td = JSON.parse(json);
        if (td.domain.chainId !== this.chainId) throw new Error('chainId mismatch'); // MetaMask enforces this
        this.signedTypedData.push(td);
        const { EIP712Domain: _d, ...types } = td.types;
        return signer.signTypedData(td.domain, types, td.message);
      }
      default: throw new Error(`unsupported ${method}`);
    }
  }
  on(event: string, l: (...a: any[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(l);
  }
  removeListener(event: string, l: (...a: any[]) => void) { this.listeners.get(event)?.delete(l); }
  emit(event: string, ...args: unknown[]) { this.listeners.get(event)?.forEach(l => l(...args)); }
}

export interface FetchLog { url: string; body: any }

/**
 * Stub global fetch for the Hyperliquid API. `exchange` decides the response
 * to each /exchange POST; info requests get empty-account defaults.
 */
export function stubHyperliquidFetch(opts: {
  exchange?: (body: any) => unknown;
  info?: (body: any) => unknown;
} = {}) {
  const calls: FetchLog[] = [];
  const fn = vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    let out: unknown;
    if (url.endsWith('/exchange')) {
      out = opts.exchange ? opts.exchange(body) : { status: 'ok', response: { type: 'default' } };
    } else {
      out = opts.info?.(body);
      if (out === undefined) {
        switch (body?.type) {
          case 'perpDexs': out = [null, { name: 'xyz' }]; break;
          case 'extraAgents': out = []; break;
          case 'frontendOpenOrders': out = []; break;
          case 'clearinghouseState': out = {
            marginSummary: { accountValue: '0', totalMarginUsed: '0' }, withdrawable: '0', assetPositions: [],
          }; break;
          default: out = {};
        }
      }
    }
    const text = JSON.stringify(out);
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { calls, exchangeCalls: () => calls.filter(c => c.url.endsWith('/exchange')).map(c => c.body) };
}

export const META = {
  universe: [
    { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
    { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
    { name: 'HPOS', szDecimals: 0, maxLeverage: 3, onlyIsolated: true, isDelisted: true },
  ],
};
export const XYZ_META = {
  universe: [
    { name: 'xyz:XYZ100', szDecimals: 4, maxLeverage: 30 },
    { name: 'xyz:TSLA', szDecimals: 3, maxLeverage: 10, onlyIsolated: true },
  ],
};

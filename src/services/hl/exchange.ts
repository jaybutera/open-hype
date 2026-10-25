import type { Wallet } from 'ethers';
import type { OrderWire } from '../../types/order.ts';
import { signL1Action, type HLSignature, type ApproveAgentMessage } from './signing.ts';

export type Grouping = 'na' | 'normalTpsl' | 'positionTpsl';

export type OrderStatus =
  | { kind: 'resting'; oid: number }
  | { kind: 'filled'; oid: number; totalSz: string; avgPx: string }
  | { kind: 'pending'; detail: string }
  | { kind: 'error'; message: string };

export type CancelStatus = { ok: true } | { ok: false; message: string };

/** Request-level failure: the exchange rejected the whole action (bad signature, unknown agent, rate limit...). */
export class ExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExchangeError';
  }
}

/** True when the signer is not (or no longer) an approved agent for the account. */
export function isUnknownSignerError(message: string): boolean {
  return /does not exist/i.test(message) && /(api wallet|user)/i.test(message);
}

/**
 * Rebuild order wires with the exact key order the exchange hashes
 * (a, b, p, s, r, t, c). msgpack preserves insertion order, so a stray key
 * order changes the hash and the signature recovers to a random address.
 */
export function orderAction(orders: OrderWire[], grouping: Grouping = 'na') {
  return {
    type: 'order',
    orders: orders.map(orderWire),
    grouping,
  };
}

function orderWire(o: OrderWire): Record<string, unknown> {
  const t = 'limit' in o.t
    ? { limit: { tif: o.t.limit.tif } }
    : { trigger: { isMarket: o.t.trigger.isMarket, triggerPx: o.t.trigger.triggerPx, tpsl: o.t.trigger.tpsl } };
  const w: Record<string, unknown> = { a: o.a, b: o.b, p: o.p, s: o.s, r: o.r, t };
  if (o.c) w.c = o.c;
  return w;
}

/** batchModify replaces each order in place by oid; the new spec uses the same wire key order as `order`. */
export function batchModifyAction(modifies: { oid: number; order: OrderWire }[]) {
  return { type: 'batchModify', modifies: modifies.map(m => ({ oid: m.oid, order: orderWire(m.order) })) };
}

export function parseOrderStatuses(statuses: unknown[]): OrderStatus[] {
  return statuses.map((st): OrderStatus => {
    if (typeof st === 'string') return { kind: 'pending', detail: st };
    const o = st as Record<string, Record<string, unknown> | string>;
    if (o.resting && typeof o.resting === 'object') return { kind: 'resting', oid: Number(o.resting.oid) };
    if (o.filled && typeof o.filled === 'object') {
      return { kind: 'filled', oid: Number(o.filled.oid), totalSz: String(o.filled.totalSz), avgPx: String(o.filled.avgPx) };
    }
    if (typeof o.error === 'string') return { kind: 'error', message: o.error };
    return { kind: 'error', message: `Unrecognised status: ${JSON.stringify(st)}` };
  });
}

interface ExchangeResponse {
  status: 'ok' | 'err';
  response: string | { type: string; data?: { statuses: unknown[] } };
}

async function postJson(apiBase: string, body: unknown, fetchImpl: typeof fetch): Promise<ExchangeResponse> {
  const res = await fetchImpl(`${apiBase}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new ExchangeError(`HTTP ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new ExchangeError(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const r = data as ExchangeResponse;
  if (r.status !== 'ok') throw new ExchangeError(typeof r.response === 'string' ? r.response : JSON.stringify(r.response));
  return r;
}

function statusesOf(r: ExchangeResponse): unknown[] {
  if (typeof r.response === 'object' && r.response.data?.statuses) return r.response.data.statuses;
  return [];
}

export interface ExchangeClientOptions {
  apiBase: string;
  isMainnet: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Signs and submits L1 actions with an agent (or API wallet) key. */
export class ExchangeClient {
  private lastNonce = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly signer: Wallet, private readonly opts: ExchangeClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
  }

  get signerAddress(): string {
    return this.signer.address;
  }

  /** Millisecond timestamps, strictly increasing even for back-to-back calls. */
  private nextNonce(): number {
    this.lastNonce = Math.max(this.now(), this.lastNonce + 1);
    return this.lastNonce;
  }

  /**
   * Build the signed request body without sending it. `vaultAddress` acts on a
   * sub-account (or vault) of the master; it is part of the signed hash.
   */
  async signAction(action: unknown, vaultAddress?: string | null): Promise<{ action: unknown; nonce: number; signature: HLSignature; vaultAddress?: string }> {
    const nonce = this.nextNonce();
    const vault = vaultAddress ? vaultAddress.toLowerCase() : null;
    const signature = await signL1Action(this.signer, action, nonce, this.opts.isMainnet, vault);
    return vault ? { action, nonce, signature, vaultAddress: vault } : { action, nonce, signature };
  }

  private async send(action: unknown, vaultAddress?: string | null): Promise<ExchangeResponse> {
    return postJson(this.opts.apiBase, await this.signAction(action, vaultAddress), this.fetchImpl);
  }

  async placeOrders(orders: OrderWire[], grouping: Grouping = 'na', vaultAddress?: string | null): Promise<OrderStatus[]> {
    return parseOrderStatuses(statusesOf(await this.send(orderAction(orders, grouping), vaultAddress)));
  }

  async batchModify(modifies: { oid: number; order: OrderWire }[], vaultAddress?: string | null): Promise<OrderStatus[]> {
    return parseOrderStatuses(statusesOf(await this.send(batchModifyAction(modifies), vaultAddress)));
  }

  async cancel(cancels: { a: number; o: number }[], vaultAddress?: string | null): Promise<CancelStatus[]> {
    const r = await this.send({ type: 'cancel', cancels: cancels.map(c => ({ a: c.a, o: c.o })) }, vaultAddress);
    return statusesOf(r).map(st =>
      st === 'success' ? { ok: true as const } : { ok: false as const, message: (st as { error?: string }).error ?? JSON.stringify(st) });
  }

  async updateLeverage(asset: number, isCross: boolean, leverage: number, vaultAddress?: string | null): Promise<void> {
    await this.send({ type: 'updateLeverage', asset, isCross, leverage: Math.floor(leverage) }, vaultAddress);
  }
}

/** Submit a wallet-signed ApproveAgent action. */
export async function submitApproveAgent(
  apiBase: string,
  msg: ApproveAgentMessage,
  signatureChainIdHex: string,
  signature: HLSignature,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<void> {
  const action = {
    type: 'approveAgent',
    hyperliquidChain: msg.hyperliquidChain,
    signatureChainId: signatureChainIdHex,
    agentAddress: msg.agentAddress,
    agentName: msg.agentName,
    nonce: msg.nonce,
  };
  await postJson(apiBase, { action, nonce: msg.nonce, signature }, fetchImpl);
}

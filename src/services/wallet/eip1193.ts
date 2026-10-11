/**
 * Browser wallet access via EIP-1193, with EIP-6963 multi-wallet discovery
 * (MetaMask, Rabby, Coinbase, Brave...) and a window.ethereum fallback.
 * The wallet keeps its keys; this module only asks it for accounts and
 * signatures, each of which the user approves in the wallet's own prompt.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
}

export interface WalletOption {
  /** Stable id used to reconnect after reload (EIP-6963 rdns, or "injected"). */
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

const announced = new Map<string, WalletOption>();
let listening = false;

function onAnnounce(e: Event) {
  const d = (e as CustomEvent<Eip6963Detail>).detail;
  if (!d?.info || !d.provider) return;
  announced.set(d.info.rdns || d.info.uuid, { id: d.info.rdns || d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
}

/** Ask installed wallets to announce themselves. Safe to call repeatedly. */
export function requestWalletAnnouncements(): void {
  if (typeof window === 'undefined') return;
  if (!listening) {
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    listening = true;
  }
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function listWallets(): WalletOption[] {
  const out = [...announced.values()];
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (injected && !out.some(w => w.provider === injected)) {
    out.push({ id: 'injected', name: 'Browser wallet', provider: injected });
  }
  return out;
}

export function findWallet(id: string): WalletOption | undefined {
  return listWallets().find(w => w.id === id);
}

/** EIP-1193 error codes users hit in practice, mapped to plain messages. */
export function describeWalletError(err: unknown): string {
  const e = err as { code?: number; message?: string; shortMessage?: string };
  if (e?.code === 4001) return 'Request rejected in wallet';
  if (e?.code === -32002) return 'Wallet already has a pending request; open the wallet to continue';
  if (e?.code === 4100) return 'Wallet has not authorised this site';
  if (e?.code === 4900 || e?.code === 4901) return 'Wallet is disconnected from its network';
  return e?.shortMessage ?? e?.message ?? String(err);
}

export async function requestAccounts(p: Eip1193Provider): Promise<string[]> {
  return (await p.request({ method: 'eth_requestAccounts' })) as string[];
}

/** Accounts already authorised for this site; never opens a prompt. */
export async function existingAccounts(p: Eip1193Provider): Promise<string[]> {
  return (await p.request({ method: 'eth_accounts' })) as string[];
}

export async function chainIdOf(p: Eip1193Provider): Promise<number> {
  return Number(await p.request({ method: 'eth_chainId' }));
}

export async function signTypedDataV4(p: Eip1193Provider, address: string, typedData: unknown): Promise<string> {
  return (await p.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typedData)] })) as string;
}

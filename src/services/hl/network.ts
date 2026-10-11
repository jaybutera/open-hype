/**
 * Which Hyperliquid network the app talks to. Market data, asset ids and
 * signatures all depend on it, so it is fixed for the lifetime of the page:
 * switching persists the choice and reloads.
 */
export type Network = 'mainnet' | 'testnet';

const NETWORK_KEY = 'hl-network';

const URLS: Record<Network, { api: string; ws: string }> = {
  mainnet: { api: 'https://api.hyperliquid.xyz', ws: 'wss://api.hyperliquid.xyz/ws' },
  testnet: { api: 'https://api.hyperliquid-testnet.xyz', ws: 'wss://api.hyperliquid-testnet.xyz/ws' },
};

function loadNetwork(): Network {
  try {
    return localStorage.getItem(NETWORK_KEY) === 'testnet' ? 'testnet' : 'mainnet';
  } catch {
    return 'mainnet';
  }
}

export const NETWORK: Network = loadNetwork();
export const IS_MAINNET = NETWORK === 'mainnet';
export const NETWORK_URLS = URLS[NETWORK];
export const urlsFor = (n: Network) => URLS[n];

export function switchNetwork(next: Network): void {
  if (next === NETWORK) return;
  try { localStorage.setItem(NETWORK_KEY, next); } catch {}
  window.location.reload();
}

import { useEffect } from 'react';
import { useWalletStore } from '../store/useWalletStore.ts';
import { useLiveAccountStore } from '../store/useLiveAccountStore.ts';
import { useSettingsStore } from '../store/useSettingsStore.ts';
import { requestWalletAnnouncements } from '../services/wallet/eip1193.ts';

const POLL_MS = 5000;

/** Restore the wallet session on load and keep live balances/positions/orders fresh. */
export function useLiveAccountSync(): void {
  const address = useWalletStore(s => s.address);
  const mode = useSettingsStore(s => s.mode);

  useEffect(() => {
    requestWalletAnnouncements();
    // Give EIP-6963 wallets a moment to announce before reconnecting.
    const t = setTimeout(() => void useWalletStore.getState().restore(), 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const store = useLiveAccountStore.getState();
    if (!address) { store.reset(); return; }
    void store.refresh(address);
    if (mode !== 'live') return;
    const id = setInterval(() => void useLiveAccountStore.getState().refresh(address), POLL_MS);
    return () => clearInterval(id);
  }, [address, mode]);
}

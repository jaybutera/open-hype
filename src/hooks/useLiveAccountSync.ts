import { useEffect } from 'react';
import { useWalletStore, selectActiveAccount } from '../store/useWalletStore.ts';
import { useLiveAccountStore } from '../store/useLiveAccountStore.ts';
import { useSettingsStore } from '../store/useSettingsStore.ts';
import { requestWalletAnnouncements } from '../services/wallet/eip1193.ts';

const POLL_MS = 5000;

/** Restore the wallet session on load and keep live balances/positions/orders fresh. */
export function useLiveAccountSync(): void {
  const address = useWalletStore(selectActiveAccount);
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
    let ticks = 0;
    const id = setInterval(() => {
      void useLiveAccountStore.getState().refresh(address);
      // Pick up sub-accounts created elsewhere and refresh their balances in the selector.
      if (++ticks % 6 === 0) void useWalletStore.getState().loadSubAccounts();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [address, mode]);
}

import { create } from 'zustand';
import { Wallet } from 'ethers';

interface WalletStore {
  wallet: Wallet | null;
  address: string | null;
  connect: (privateKey: string) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletStore>((set) => ({
  wallet: null,
  address: null,
  connect: (privateKey: string) => {
    try {
      const wallet = new Wallet(privateKey);
      set({ wallet, address: wallet.address });
    } catch {
      set({ wallet: null, address: null });
    }
  },
  disconnect: () => set({ wallet: null, address: null }),
}));

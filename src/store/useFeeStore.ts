import { create } from 'zustand';
import { MAKER_FEE_RATE, TAKER_FEE_RATE } from '../config/constants.ts';
import { fetchUserFees } from '../services/api/info.ts';

interface FeeStore {
  makerRate: string;
  takerRate: string;
  loaded: boolean;
  fetchFees: (address: string) => Promise<void>;
  resetToDefaults: () => void;
}

export const useFeeStore = create<FeeStore>((set) => ({
  makerRate: MAKER_FEE_RATE,
  takerRate: TAKER_FEE_RATE,
  loaded: false,

  fetchFees: async (address: string) => {
    try {
      const resp = await fetchUserFees(address);
      set({
        makerRate: resp.userAddRate,
        takerRate: resp.userCrossRate,
        loaded: true,
      });
    } catch {
      // Keep defaults on failure
      set({ loaded: true });
    }
  },

  resetToDefaults: () => set({
    makerRate: MAKER_FEE_RATE,
    takerRate: TAKER_FEE_RATE,
    loaded: false,
  }),
}));

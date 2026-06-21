import { create } from 'zustand';
import {
  loadAccounts,
  saveAccounts,
  createDefaultAccount,
  type PaperAccount,
  type PaperAccountsData,
  type JournalEntry,
} from '../engine/paper/persistence.ts';

interface PaperAccountsStore {
  accounts: PaperAccount[];
  activeAccountId: string;

  getActiveAccount: () => PaperAccount;
  setActiveAccount: (id: string) => void;
  createAccount: (name: string, initialBalance: string) => void;
  deleteAccount: (id: string) => void;
  renameAccount: (id: string, name: string) => void;
  saveActiveAccountState: (state: {
    balance: string;
    positions: PaperAccount['positions'];
    openOrders: PaperAccount['openOrders'];
    fills: PaperAccount['fills'];
    optionPositions?: PaperAccount['optionPositions'];
  }) => void;

  addJournalEntry: (text: string, coin?: string) => void;
  editJournalEntry: (id: string, text: string) => void;
  deleteJournalEntry: (id: string) => void;
}

function journalId(): string {
  return `j-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function persist(data: PaperAccountsData) {
  saveAccounts(data);
}

export const usePaperAccountsStore = create<PaperAccountsStore>((set, get) => {
  const initial = loadAccounts();

  return {
    accounts: initial.accounts,
    activeAccountId: initial.activeAccountId,

    getActiveAccount: () => {
      const { accounts, activeAccountId } = get();
      return accounts.find(a => a.id === activeAccountId) ?? accounts[0];
    },

    setActiveAccount: (id) => {
      set({ activeAccountId: id });
      const { accounts } = get();
      persist({ activeAccountId: id, accounts });
    },

    createAccount: (name, initialBalance) => {
      const acct: PaperAccount = {
        ...createDefaultAccount(),
        name,
        initialBalance,
        balance: initialBalance,
      };
      const accounts = [...get().accounts, acct];
      set({ accounts, activeAccountId: acct.id });
      persist({ activeAccountId: acct.id, accounts });
    },

    deleteAccount: (id) => {
      const { accounts, activeAccountId } = get();
      if (accounts.length <= 1) return; // don't delete last account
      const next = accounts.filter(a => a.id !== id);
      const newActive = id === activeAccountId ? next[0].id : activeAccountId;
      set({ accounts: next, activeAccountId: newActive });
      persist({ activeAccountId: newActive, accounts: next });
    },

    renameAccount: (id, name) => {
      const accounts = get().accounts.map(a =>
        a.id === id ? { ...a, name } : a
      );
      set({ accounts });
      persist({ activeAccountId: get().activeAccountId, accounts });
    },

    saveActiveAccountState: (state) => {
      const { activeAccountId } = get();
      const accounts = get().accounts.map(a =>
        a.id === activeAccountId
          ? {
              ...a,
              balance: state.balance,
              positions: state.positions,
              openOrders: state.openOrders,
              fills: state.fills,
              ...(state.optionPositions !== undefined ? { optionPositions: state.optionPositions } : {}),
            }
          : a
      );
      set({ accounts });
      persist({ activeAccountId, accounts });
    },

    addJournalEntry: (text, coin) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const entry: JournalEntry = {
        id: journalId(),
        timestamp: Date.now(),
        text: trimmed,
        ...(coin ? { coin } : {}),
      };
      const { activeAccountId } = get();
      const accounts = get().accounts.map(a =>
        a.id === activeAccountId
          ? { ...a, journalEntries: [...(a.journalEntries ?? []), entry] }
          : a
      );
      set({ accounts });
      persist({ activeAccountId, accounts });
    },

    editJournalEntry: (id, text) => {
      const trimmed = text.trim();
      const { activeAccountId } = get();
      const accounts = get().accounts.map(a =>
        a.id === activeAccountId
          ? {
              ...a,
              journalEntries: (a.journalEntries ?? []).map(e =>
                e.id === id ? { ...e, text: trimmed } : e
              ),
            }
          : a
      );
      set({ accounts });
      persist({ activeAccountId, accounts });
    },

    deleteJournalEntry: (id) => {
      const { activeAccountId } = get();
      const accounts = get().accounts.map(a =>
        a.id === activeAccountId
          ? { ...a, journalEntries: (a.journalEntries ?? []).filter(e => e.id !== id) }
          : a
      );
      set({ accounts });
      persist({ activeAccountId, accounts });
    },
  };
});

import type { LedgerEntry } from './ledger.ts';
import type { PaperPosition } from './positions.ts';
import type { PaperOrder } from './matching.ts';

const STORAGE_KEY = 'hl-paper-accounts';

export interface PaperAccount {
  id: string;
  name: string;
  createdAt: number;
  initialBalance: string;
  balance: string;
  positions: PaperPosition[];
  openOrders: PaperOrder[];
  fills: LedgerEntry[];
}

export interface PaperAccountsData {
  activeAccountId: string;
  accounts: PaperAccount[];
}

function generateId(): string {
  return `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultAccount(): PaperAccount {
  return {
    id: generateId(),
    name: 'Default',
    createdAt: Date.now(),
    initialBalance: '10000',
    balance: '10000',
    positions: [],
    openOrders: [],
    fills: [],
  };
}

export function loadAccounts(): PaperAccountsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data: PaperAccountsData = JSON.parse(raw);
      if (data.accounts.length > 0) return data;
    }
  } catch { /* ignore corrupt data */ }

  const defaultAcct = createDefaultAccount();
  const data: PaperAccountsData = {
    activeAccountId: defaultAcct.id,
    accounts: [defaultAcct],
  };
  saveAccounts(data);
  return data;
}

export function saveAccounts(data: PaperAccountsData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function exportAccountTrades(account: PaperAccount): string {
  return JSON.stringify({
    accountName: account.name,
    createdAt: new Date(account.createdAt).toISOString(),
    initialBalance: account.initialBalance,
    finalBalance: account.balance,
    totalTrades: account.fills.length,
    trades: account.fills.map(f => ({
      id: f.id,
      time: new Date(f.timestamp).toISOString(),
      coin: f.coin,
      side: f.side,
      size: f.size,
      price: f.price,
      fee: f.fee,
      realizedPnl: f.realizedPnl,
      balanceAfter: f.balanceAfter,
    })),
  }, null, 2);
}

import Decimal from 'decimal.js';

export interface LedgerEntry {
  id: string;
  timestamp: number;
  coin: string;
  side: 'buy' | 'sell';
  size: string;
  price: string;
  fee: string;
  realizedPnl: string;
  balanceAfter: string;
}

let nextId = 1;

export function createLedgerEntry(
  coin: string,
  side: 'buy' | 'sell',
  size: Decimal,
  price: Decimal,
  fee: Decimal,
  realizedPnl: Decimal,
  balanceAfter: Decimal,
): LedgerEntry {
  return {
    id: `paper-${nextId++}`,
    timestamp: Date.now(),
    coin,
    side,
    size: size.toString(),
    price: price.toString(),
    fee: fee.toString(),
    realizedPnl: realizedPnl.toString(),
    balanceAfter: balanceAfter.toString(),
  };
}

export function resetLedgerIds(startFrom: number = 1): void {
  nextId = startFrom;
}

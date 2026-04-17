import Decimal from 'decimal.js';

export type LedgerKind = 'perp' | 'option-open' | 'option-close' | 'option-expire';

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
  kind?: LedgerKind;
  spreadId?: string;
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

export function createOptionLedgerEntry(params: {
  kind: LedgerKind;
  contractSymbol: string;
  side: 'buy' | 'sell';
  qty: Decimal;
  premiumPerShare: Decimal;
  cashDelta: Decimal;
  realizedPnl: Decimal;
  balanceAfter: Decimal;
  spreadId: string;
}): LedgerEntry {
  return {
    id: `paper-${nextId++}`,
    timestamp: Date.now(),
    coin: params.contractSymbol,
    side: params.side,
    size: params.qty.toString(),
    price: params.premiumPerShare.toString(),
    fee: '0',
    realizedPnl: params.realizedPnl.toString(),
    balanceAfter: params.balanceAfter.toString(),
    kind: params.kind,
    spreadId: params.spreadId,
  };
}

export function resetLedgerIds(startFrom: number = 1): void {
  nextId = startFrom;
}

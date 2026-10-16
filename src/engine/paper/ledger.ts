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
  /** Hyperliquid-style direction for perp fills, e.g. "Open Long", "Close Short", "Long > Short". */
  dir?: string;
}

/** Direction label for a perp fill against the position size (signed) before it. */
export function fillDir(prevSzi: Decimal, side: 'buy' | 'sell', size: Decimal): string {
  const next = side === 'buy' ? prevSzi.add(size) : prevSzi.sub(size);
  if (prevSzi.isZero()) return side === 'buy' ? 'Open Long' : 'Open Short';
  if (prevSzi.gt(0)) {
    if (side === 'buy') return 'Open Long';
    return next.lt(0) ? 'Long > Short' : 'Close Long';
  }
  if (side === 'sell') return 'Open Short';
  return next.gt(0) ? 'Short > Long' : 'Close Short';
}

let nextId = 1;

/**
 * Fill in `dir` on perp fills saved before it was recorded. Every paper position change is a
 * fill, so walking the ledger in order rebuilds the position each fill was made against.
 */
export function withFillDirs(fills: LedgerEntry[]): LedgerEntry[] {
  const szi = new Map<string, Decimal>();
  return fills.map(f => {
    if (f.kind && f.kind !== 'perp') return f;
    const prev = szi.get(f.coin) ?? new Decimal(0);
    const size = new Decimal(f.size);
    szi.set(f.coin, f.side === 'buy' ? prev.add(size) : prev.sub(size));
    return f.dir ? f : { ...f, dir: fillDir(prev, f.side, size) };
  });
}

export function createLedgerEntry(
  coin: string,
  side: 'buy' | 'sell',
  size: Decimal,
  price: Decimal,
  fee: Decimal,
  realizedPnl: Decimal,
  balanceAfter: Decimal,
  timestamp: number = Date.now(),
  dir?: string,
): LedgerEntry {
  return {
    id: `paper-${nextId++}`,
    timestamp,
    coin,
    side,
    ...(dir ? { dir } : {}),
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
  timestamp?: number;
}): LedgerEntry {
  return {
    id: `paper-${nextId++}`,
    timestamp: params.timestamp ?? Date.now(),
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

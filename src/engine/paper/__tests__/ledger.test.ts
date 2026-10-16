import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { fillDir, withFillDirs, type LedgerEntry } from '../ledger.ts';

const d = (n: number) => new Decimal(n);

describe('fillDir', () => {
  it('labels opens, adds, closes and flips like Hyperliquid', () => {
    expect(fillDir(d(0), 'buy', d(1))).toBe('Open Long');
    expect(fillDir(d(0), 'sell', d(1))).toBe('Open Short');
    expect(fillDir(d(1), 'buy', d(1))).toBe('Open Long');
    expect(fillDir(d(-1), 'sell', d(1))).toBe('Open Short');
    expect(fillDir(d(2), 'sell', d(1))).toBe('Close Long');
    expect(fillDir(d(2), 'sell', d(2))).toBe('Close Long');
    expect(fillDir(d(-2), 'buy', d(2))).toBe('Close Short');
    expect(fillDir(d(1), 'sell', d(3))).toBe('Long > Short');
    expect(fillDir(d(-1), 'buy', d(3))).toBe('Short > Long');
  });
});

describe('withFillDirs', () => {
  const fill = (id: string, coin: string, side: 'buy' | 'sell', size: string, extra: Partial<LedgerEntry> = {}): LedgerEntry =>
    ({ id, timestamp: 0, coin, side, size, price: '1', fee: '0', realizedPnl: '0', balanceAfter: '0', ...extra });

  it('infers direction from the running position per coin, keeping recorded ones and skipping options', () => {
    const out = withFillDirs([
      fill('1', 'BTC', 'buy', '1'),
      fill('2', 'ETH', 'sell', '2'),
      fill('3', 'BTC', 'sell', '3'),
      fill('4', 'SPY-C', 'buy', '1', { kind: 'option-open' }),
      fill('5', 'ETH', 'buy', '2', { dir: 'Close Short' }),
      fill('6', 'BTC', 'buy', '2'),
    ]);
    expect(out.map(f => f.dir)).toEqual(['Open Long', 'Open Short', 'Long > Short', undefined, 'Close Short', 'Close Short']);
  });
});

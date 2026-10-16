import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { fillDir } from '../ledger.ts';

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

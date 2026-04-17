import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  SHORT_PREMIUM_MARGIN_MULT,
  legCashDelta,
  legMarginRequired,
  computeOpenLegsCost,
} from '../margin.ts';
import { CONTRACT_MULTIPLIER } from '../OptionPosition.ts';

describe('SHORT_PREMIUM_MARGIN_MULT', () => {
  it('is the 5x conservative cash-secured multiplier documented in the spec', () => {
    expect(SHORT_PREMIUM_MARGIN_MULT).toBe(5);
  });
});

describe('legCashDelta', () => {
  it('long leg produces positive debit = entry × 100 × qty', () => {
    const delta = legCashDelta(new Decimal(2), new Decimal('3.50'));
    expect(delta.toString()).toBe(new Decimal(700).toString());
  });

  it('short leg produces negative value (cash received)', () => {
    const delta = legCashDelta(new Decimal(-1), new Decimal('4.25'));
    expect(delta.toString()).toBe(new Decimal(-425).toString());
  });

  it('zero szi produces zero', () => {
    expect(legCashDelta(new Decimal(0), new Decimal(5)).toString()).toBe('0');
  });
});

describe('legMarginRequired', () => {
  it('long leg requires zero margin', () => {
    expect(legMarginRequired(new Decimal(3), new Decimal(5)).toString()).toBe('0');
  });

  it('short leg requires 5× premium × 100 × qty', () => {
    const m = legMarginRequired(new Decimal(-2), new Decimal('1.50'));
    // 2 * 1.50 * 100 * 5 = 1500
    expect(m.toString()).toBe(new Decimal(1500).toString());
  });

  it('zero-premium short still requires zero margin (degenerate quote)', () => {
    expect(legMarginRequired(new Decimal(-1), new Decimal(0)).toString()).toBe('0');
  });
});

describe('computeOpenLegsCost', () => {
  it('single long leg: cashRequired = netDebit, totalMargin = 0', () => {
    const cost = computeOpenLegsCost([{ szi: new Decimal(1), entryPx: new Decimal(5) }]);
    expect(cost.netDebit.toString()).toBe('500');
    expect(cost.totalMargin.toString()).toBe('0');
    expect(cost.cashRequired.toString()).toBe('500');
  });

  it('single short leg: cashRequired = |netDebit| shifted by short margin', () => {
    // short 1 at $3 premium: receive $300, margin = 3 * 100 * 1 * 5 = 1500
    // netDebit = -300, totalMargin = 1500, cashRequired = 1200
    const cost = computeOpenLegsCost([{ szi: new Decimal(-1), entryPx: new Decimal(3) }]);
    expect(cost.netDebit.toString()).toBe('-300');
    expect(cost.totalMargin.toString()).toBe('1500');
    expect(cost.cashRequired.toString()).toBe('1200');
  });

  it('vertical debit spread (long + short): long premium debited, short margin reserved', () => {
    // Long 1 call @ $5, short 1 higher-strike call @ $2
    // netDebit = 500 - 200 = 300
    // totalMargin = 2 * 100 * 1 * 5 = 1000
    // cashRequired = 1300
    const cost = computeOpenLegsCost([
      { szi: new Decimal(1), entryPx: new Decimal(5) },
      { szi: new Decimal(-1), entryPx: new Decimal(2) },
    ]);
    expect(cost.netDebit.toString()).toBe('300');
    expect(cost.totalMargin.toString()).toBe('1000');
    expect(cost.cashRequired.toString()).toBe('1300');
  });

  it('credit spread: netDebit negative, short margin dominates', () => {
    // Short 1 put @ $4, long 1 lower-strike put @ $1
    // netDebit = 100 - 400 = -300
    // totalMargin = 4 * 100 * 1 * 5 = 2000
    // cashRequired = 1700
    const cost = computeOpenLegsCost([
      { szi: new Decimal(-1), entryPx: new Decimal(4) },
      { szi: new Decimal(1), entryPx: new Decimal(1) },
    ]);
    expect(cost.netDebit.toString()).toBe('-300');
    expect(cost.totalMargin.toString()).toBe('2000');
    expect(cost.cashRequired.toString()).toBe('1700');
  });

  it('empty legs → all zero', () => {
    const cost = computeOpenLegsCost([]);
    expect(cost.netDebit.toString()).toBe('0');
    expect(cost.totalMargin.toString()).toBe('0');
    expect(cost.cashRequired.toString()).toBe('0');
  });

  it('quantity scales cash and margin linearly', () => {
    const cost = computeOpenLegsCost([{ szi: new Decimal(-5), entryPx: new Decimal(2) }]);
    // 5 shorts @ $2: receive $1000, margin = 5 * 2 * 100 * 5 = 5000
    expect(cost.netDebit.toString()).toBe('-1000');
    expect(cost.totalMargin.toString()).toBe('5000');
  });

  it('CONTRACT_MULTIPLIER stays 100 — guards against drift', () => {
    expect(CONTRACT_MULTIPLIER).toBe(100);
  });
});

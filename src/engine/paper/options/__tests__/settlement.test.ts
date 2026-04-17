import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  legIntrinsicAtExpiration,
  buildSettlementDraft,
  selectSettleableLegs,
} from '../settlement.ts';
import type { OptionPosition } from '../OptionPosition.ts';

function mkLeg(overrides: Partial<OptionPosition> = {}): OptionPosition {
  return {
    id: 'paper-opt-1',
    spreadId: 'paper-spread-1',
    contractSymbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: new Decimal(400),
    expiration: 1776384000, // 2026-04-17
    szi: new Decimal(1),
    entryPx: new Decimal(5),
    marginUsed: new Decimal(0),
    openedAt: 1776000000,
    ...overrides,
  };
}

describe('legIntrinsicAtExpiration', () => {
  it('call ITM → S - K', () => {
    const v = legIntrinsicAtExpiration({ type: 'call', strike: new Decimal(400) }, new Decimal(425));
    expect(v.toString()).toBe('25');
  });

  it('call ATM → 0', () => {
    const v = legIntrinsicAtExpiration({ type: 'call', strike: new Decimal(400) }, new Decimal(400));
    expect(v.toString()).toBe('0');
  });

  it('call OTM → 0 (not negative)', () => {
    const v = legIntrinsicAtExpiration({ type: 'call', strike: new Decimal(400) }, new Decimal(380));
    expect(v.toString()).toBe('0');
  });

  it('put ITM → K - S', () => {
    const v = legIntrinsicAtExpiration({ type: 'put', strike: new Decimal(400) }, new Decimal(375));
    expect(v.toString()).toBe('25');
  });

  it('put OTM → 0', () => {
    const v = legIntrinsicAtExpiration({ type: 'put', strike: new Decimal(400) }, new Decimal(420));
    expect(v.toString()).toBe('0');
  });
});

describe('buildSettlementDraft', () => {
  it('long ITM call: closeSide=sell, cashDelta = intrinsic × 100 × qty, pnl = (intrinsic - entry) × 100', () => {
    const leg = mkLeg({ szi: new Decimal(2), entryPx: new Decimal(5) });
    const d = buildSettlementDraft(leg, new Decimal(425));
    expect(d.inTheMoney).toBe(true);
    expect(d.closeSide).toBe('sell');
    expect(d.intrinsic.toString()).toBe('25');
    expect(d.cashDelta.toString()).toBe('5000'); // 25 × 100 × 2
    expect(d.realizedPnl.toString()).toBe('4000'); // (25-5) × 100 × 2
  });

  it('long OTM call: closeSide=sell, cashDelta=0, pnl = -entry × 100 × qty', () => {
    const leg = mkLeg({ szi: new Decimal(1), entryPx: new Decimal(5) });
    const d = buildSettlementDraft(leg, new Decimal(380));
    expect(d.inTheMoney).toBe(false);
    expect(d.closeSide).toBe('sell');
    expect(d.cashDelta.toString()).toBe('0');
    expect(d.realizedPnl.toString()).toBe('-500');
  });

  it('short ITM call: closeSide=buy, cashDelta negative, pnl = -(intrinsic-entry) × 100', () => {
    const leg = mkLeg({ szi: new Decimal(-1), entryPx: new Decimal(10) });
    const d = buildSettlementDraft(leg, new Decimal(425));
    expect(d.closeSide).toBe('buy');
    expect(d.cashDelta.toString()).toBe('-2500'); // -1 × 25 × 100
    expect(d.realizedPnl.toString()).toBe('-1500'); // (25-10) × -1 × 100
  });

  it('short OTM put: max profit = entire premium × 100 × qty', () => {
    const leg = mkLeg({ type: 'put', szi: new Decimal(-1), entryPx: new Decimal(3), strike: new Decimal(400) });
    const d = buildSettlementDraft(leg, new Decimal(430));
    expect(d.inTheMoney).toBe(false);
    expect(d.cashDelta.toString()).toBe('0');
    expect(d.realizedPnl.toString()).toBe('300'); // (0 - 3) × -1 × 100
  });

  it('long ITM put: intrinsic = K-S, cashDelta positive', () => {
    const leg = mkLeg({ type: 'put', szi: new Decimal(1), entryPx: new Decimal(4), strike: new Decimal(400) });
    const d = buildSettlementDraft(leg, new Decimal(375));
    expect(d.intrinsic.toString()).toBe('25');
    expect(d.cashDelta.toString()).toBe('2500');
    expect(d.realizedPnl.toString()).toBe('2100');
  });
});

describe('selectSettleableLegs', () => {
  it('empty positions → empty result', () => {
    const r = selectSettleableLegs([], new Map(), 2000000000);
    expect(r).toEqual([]);
  });

  it('excludes legs whose expiration is still in the future', () => {
    const leg = mkLeg({ expiration: 3000000000 });
    const prices = new Map([['TSLA', new Decimal(400)]]);
    const r = selectSettleableLegs([leg], prices, 1000000000);
    expect(r).toEqual([]);
  });

  it('includes expired legs with known underlying price', () => {
    const leg = mkLeg({ expiration: 1000 });
    const prices = new Map([['TSLA', new Decimal(400)]]);
    const r = selectSettleableLegs([leg], prices, 2000);
    expect(r).toHaveLength(1);
    expect(r[0].underlyingPrice.toString()).toBe('400');
  });

  it('excludes expired legs whose underlying is missing from prices', () => {
    const leg = mkLeg({ underlying: 'NVDA', expiration: 1000 });
    const prices = new Map([['TSLA', new Decimal(400)]]);
    const r = selectSettleableLegs([leg], prices, 2000);
    expect(r).toEqual([]);
  });

  it('settles exactly-at-expiration legs (expiration === now)', () => {
    const leg = mkLeg({ expiration: 2000 });
    const prices = new Map([['TSLA', new Decimal(400)]]);
    const r = selectSettleableLegs([leg], prices, 2000);
    expect(r).toHaveLength(1);
  });

  it('mixed batch: only expired+priced come through', () => {
    const a = mkLeg({ id: 'a', expiration: 1000, underlying: 'TSLA' });
    const b = mkLeg({ id: 'b', expiration: 5000, underlying: 'TSLA' });
    const c = mkLeg({ id: 'c', expiration: 1000, underlying: 'NVDA' });
    const prices = new Map([['TSLA', new Decimal(400)]]);
    const r = selectSettleableLegs([a, b, c], prices, 2000);
    expect(r).toHaveLength(1);
    expect(r[0].leg.id).toBe('a');
  });
});

import { describe, it, expect } from 'vitest';
import type { LedgerEntry, LedgerKind } from '../../../engine/paper/ledger.ts';
import {
  groupFillsForDay,
  lifecycleVerb,
  type FillGroupItem,
  type SpreadFillGroup,
} from '../pnlFillGroups';

interface FillOverrides {
  id?: string;
  coin?: string;
  side?: 'buy' | 'sell';
  size?: string;
  price?: string;
  realizedPnl?: string;
  balanceAfter?: string;
  fee?: string;
  timestamp?: number;
  kind?: LedgerKind;
  spreadId?: string;
}

let idCounter = 0;
function makeFill(o: FillOverrides = {}): LedgerEntry {
  idCounter += 1;
  return {
    id: o.id ?? `paper-${idCounter}`,
    timestamp: o.timestamp ?? 1700000000000,
    coin: o.coin ?? 'BTC',
    side: o.side ?? 'buy',
    size: o.size ?? '1',
    price: o.price ?? '0',
    fee: o.fee ?? '0',
    realizedPnl: o.realizedPnl ?? '0',
    balanceAfter: o.balanceAfter ?? '0',
    kind: o.kind,
    spreadId: o.spreadId,
  };
}

// Canonical OCC symbols used throughout
const TSLA_C_380 = 'TSLA260417C00380000';
const TSLA_C_390 = 'TSLA260417C00390000';
const TSLA_P_370 = 'TSLA260417P00370000';
const TSLA_P_360 = 'TSLA260417P00360000';

describe('groupFillsForDay', () => {
  it('returns empty array for empty input', () => {
    expect(groupFillsForDay([])).toEqual([]);
  });

  it('passes perp fills through as singles', () => {
    const a = makeFill({ coin: 'BTC', kind: undefined });
    const b = makeFill({ coin: 'ETH', kind: undefined });
    const out = groupFillsForDay([a, b]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ kind: 'single', fill: a });
    expect(out[1]).toEqual({ kind: 'single', fill: b });
  });

  it('passes single-leg option fills through as singles', () => {
    const f = makeFill({
      coin: TSLA_C_380,
      side: 'buy',
      size: '1',
      price: '5.00',
      kind: 'option-open',
      spreadId: 'sp1',
    });
    const out = groupFillsForDay([f]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: 'single', fill: f });
  });

  it('groups 2-leg open spread with same spreadId and lifecycle', () => {
    const leg1 = makeFill({
      coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
      kind: 'option-open', spreadId: 'sp-vert',
    });
    const leg2 = makeFill({
      coin: TSLA_C_390, side: 'sell', size: '1', price: '2.50',
      kind: 'option-open', spreadId: 'sp-vert',
    });
    const out = groupFillsForDay([leg1, leg2]);
    expect(out).toHaveLength(1);
    const g = out[0] as SpreadFillGroup;
    expect(g.kind).toBe('spread');
    expect(g.spreadId).toBe('sp-vert');
    expect(g.lifecycle).toBe('option-open');
    expect(g.fills).toEqual([leg1, leg2]);
    expect(g.strategy).toBe('Call Vertical');
  });

  it('computes net premium as signed sum (buy negative, sell positive) × 100', () => {
    // Bought call @ $6.00, sold call @ $2.50 → net debit $3.50 × 100 = -$350.
    const leg1 = makeFill({
      coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
      kind: 'option-open', spreadId: 'sp-net',
    });
    const leg2 = makeFill({
      coin: TSLA_C_390, side: 'sell', size: '1', price: '2.50',
      kind: 'option-open', spreadId: 'sp-net',
    });
    const g = groupFillsForDay([leg1, leg2])[0] as SpreadFillGroup;
    expect(g.netPremium).toBeCloseTo(-350, 6);
  });

  it('computes positive netPremium for credit spreads (iron condor open)', () => {
    // Short iron condor: sell inner legs, buy outer legs. Net credit.
    // Short put @ 2.00, long put @ 0.80, short call @ 2.20, long call @ 0.90
    //   → credits: 2.00 + 2.20 = 4.20
    //   → debits:  0.80 + 0.90 = 1.70
    //   → net credit $2.50 × 100 = +$250
    const fills = [
      makeFill({ coin: TSLA_P_370, side: 'sell', size: '1', price: '2.00', kind: 'option-open', spreadId: 'sp-ic' }),
      makeFill({ coin: TSLA_P_360, side: 'buy',  size: '1', price: '0.80', kind: 'option-open', spreadId: 'sp-ic' }),
      makeFill({ coin: TSLA_C_380, side: 'sell', size: '1', price: '2.20', kind: 'option-open', spreadId: 'sp-ic' }),
      makeFill({ coin: TSLA_C_390, side: 'buy',  size: '1', price: '0.90', kind: 'option-open', spreadId: 'sp-ic' }),
    ];
    const g = groupFillsForDay(fills)[0] as SpreadFillGroup;
    expect(g.kind).toBe('spread');
    expect(g.netPremium).toBeCloseTo(250, 6);
    expect(g.strategy).toBe('Short Iron Condor');
  });

  it('sums realized PnL across legs in the group', () => {
    const leg1 = makeFill({
      coin: TSLA_C_380, side: 'sell', size: '1', price: '8.00',
      kind: 'option-close', spreadId: 'sp-close', realizedPnl: '200',
    });
    const leg2 = makeFill({
      coin: TSLA_C_390, side: 'buy', size: '1', price: '4.00',
      kind: 'option-close', spreadId: 'sp-close', realizedPnl: '-150',
    });
    const g = groupFillsForDay([leg1, leg2])[0] as SpreadFillGroup;
    expect(g.realizedPnl).toBeCloseTo(50, 6);
  });

  it('partitions open vs. close lifecycle into separate groups (same spreadId)', () => {
    // User opens a spread then closes it in the same day.
    const open1 = makeFill({
      coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
      kind: 'option-open', spreadId: 'sp-rr', timestamp: 1700000001000,
    });
    const open2 = makeFill({
      coin: TSLA_C_390, side: 'sell', size: '1', price: '2.50',
      kind: 'option-open', spreadId: 'sp-rr', timestamp: 1700000001000,
    });
    const close1 = makeFill({
      coin: TSLA_C_380, side: 'sell', size: '1', price: '7.50',
      kind: 'option-close', spreadId: 'sp-rr', timestamp: 1700000002000, realizedPnl: '150',
    });
    const close2 = makeFill({
      coin: TSLA_C_390, side: 'buy', size: '1', price: '1.80',
      kind: 'option-close', spreadId: 'sp-rr', timestamp: 1700000002000, realizedPnl: '70',
    });
    const out = groupFillsForDay([open1, open2, close1, close2]);
    expect(out).toHaveLength(2);
    const [g1, g2] = out as [SpreadFillGroup, SpreadFillGroup];
    expect(g1.lifecycle).toBe('option-open');
    expect(g1.fills).toEqual([open1, open2]);
    expect(g2.lifecycle).toBe('option-close');
    expect(g2.fills).toEqual([close1, close2]);
    expect(g2.realizedPnl).toBeCloseTo(220, 6);
  });

  it('preserves input order across mixed perp and spread fills', () => {
    const perp1 = makeFill({ coin: 'BTC', kind: undefined });
    const spreadLegA = makeFill({
      coin: TSLA_C_380, side: 'buy', size: '1', price: '6',
      kind: 'option-open', spreadId: 'sp-mix',
    });
    const perp2 = makeFill({ coin: 'ETH', kind: undefined });
    const spreadLegB = makeFill({
      coin: TSLA_C_390, side: 'sell', size: '1', price: '2.50',
      kind: 'option-open', spreadId: 'sp-mix',
    });
    const out = groupFillsForDay([perp1, spreadLegA, perp2, spreadLegB]);
    // perp1 single, then spread group (leg A appears first in input), then perp2.
    expect(out).toHaveLength(3);
    expect((out[0] as { fill: LedgerEntry }).fill).toBe(perp1);
    const g = out[1] as SpreadFillGroup;
    expect(g.kind).toBe('spread');
    expect(g.fills).toEqual([spreadLegA, spreadLegB]);
    expect((out[2] as { fill: LedgerEntry }).fill).toBe(perp2);
  });

  it('keeps a single option fill with a spreadId as a single (no 1-leg group)', () => {
    const f = makeFill({
      coin: TSLA_C_380, side: 'buy', size: '1', price: '6',
      kind: 'option-open', spreadId: 'sp-solo',
    });
    const out = groupFillsForDay([f]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: 'single', fill: f });
  });

  it('groups expired legs', () => {
    const leg1 = makeFill({
      coin: TSLA_C_380, side: 'sell', size: '1', price: '5.00',
      kind: 'option-expire', spreadId: 'sp-exp', realizedPnl: '-100',
    });
    const leg2 = makeFill({
      coin: TSLA_C_390, side: 'buy', size: '1', price: '0',
      kind: 'option-expire', spreadId: 'sp-exp', realizedPnl: '250',
    });
    const g = groupFillsForDay([leg1, leg2])[0] as SpreadFillGroup;
    expect(g.lifecycle).toBe('option-expire');
    expect(g.strategy).toBe('Call Vertical');
    expect(g.realizedPnl).toBeCloseTo(150, 6);
  });

  it('falls back to "N-leg spread" when a fill has an unparseable OCC symbol', () => {
    // Two fills sharing spreadId, same lifecycle, but one has a non-OCC coin.
    const leg1 = makeFill({
      coin: TSLA_C_380, side: 'buy', size: '1', price: '6',
      kind: 'option-open', spreadId: 'sp-bad',
    });
    const leg2 = makeFill({
      coin: 'NOT_AN_OCC_SYMBOL', side: 'sell', size: '1', price: '2',
      kind: 'option-open', spreadId: 'sp-bad',
    });
    const g = groupFillsForDay([leg1, leg2])[0] as SpreadFillGroup;
    expect(g.kind).toBe('spread');
    expect(g.strategy).toBe('2-leg spread');
  });

  it('first group corresponds to the earliest-ordered input fill', () => {
    const later = makeFill({
      coin: TSLA_C_380, side: 'buy', size: '1', price: '6',
      kind: 'option-open', spreadId: 'sp-B', timestamp: 2000,
    });
    const earlier = makeFill({
      coin: TSLA_C_390, side: 'sell', size: '1', price: '2',
      kind: 'option-open', spreadId: 'sp-A', timestamp: 1000,
    });
    const earlier2 = makeFill({
      coin: TSLA_C_380, side: 'buy', size: '1', price: '3',
      kind: 'option-open', spreadId: 'sp-A', timestamp: 1000,
    });
    const later2 = makeFill({
      coin: TSLA_C_390, side: 'sell', size: '1', price: '4',
      kind: 'option-open', spreadId: 'sp-B', timestamp: 2000,
    });
    // Input order determines group order — sp-A legs come first.
    const out: FillGroupItem[] = groupFillsForDay([earlier, earlier2, later, later2]);
    expect(out).toHaveLength(2);
    expect((out[0] as SpreadFillGroup).spreadId).toBe('sp-A');
    expect((out[1] as SpreadFillGroup).spreadId).toBe('sp-B');
  });
});

describe('lifecycleVerb', () => {
  it('returns "Opened" for option-open', () => {
    expect(lifecycleVerb('option-open')).toBe('Opened');
  });
  it('returns "Closed" for option-close', () => {
    expect(lifecycleVerb('option-close')).toBe('Closed');
  });
  it('returns "Expired" for option-expire', () => {
    expect(lifecycleVerb('option-expire')).toBe('Expired');
  });
});

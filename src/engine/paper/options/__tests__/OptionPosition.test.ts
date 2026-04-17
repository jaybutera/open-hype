import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  CONTRACT_MULTIPLIER,
  serializeOptionPosition,
  deserializeOptionPosition,
  legNotional,
  legCostBasis,
  legUnrealizedPnl,
  groupBySpread,
  type OptionPosition,
} from '../OptionPosition.ts';

function makePos(overrides: Partial<OptionPosition> = {}): OptionPosition {
  return {
    id: 'op-1',
    spreadId: 'sp-1',
    contractSymbol: 'TSLA260417C00400000',
    underlying: 'TSLA',
    type: 'call',
    strike: new Decimal(400),
    expiration: 1776384000,
    szi: new Decimal(1),
    entryPx: new Decimal(5),
    marginUsed: new Decimal(500),
    openedAt: 1713345600,
    ...overrides,
  };
}

describe('OptionPosition constants', () => {
  it('CONTRACT_MULTIPLIER is 100 (US equity options)', () => {
    expect(CONTRACT_MULTIPLIER).toBe(100);
  });
});

describe('serialize / deserialize round-trip', () => {
  it('preserves all fields through JSON.stringify', () => {
    const p = makePos();
    const json = JSON.parse(JSON.stringify(serializeOptionPosition(p)));
    const revived = deserializeOptionPosition(json);
    expect(revived.id).toBe(p.id);
    expect(revived.spreadId).toBe(p.spreadId);
    expect(revived.contractSymbol).toBe(p.contractSymbol);
    expect(revived.underlying).toBe(p.underlying);
    expect(revived.type).toBe(p.type);
    expect(revived.expiration).toBe(p.expiration);
    expect(revived.openedAt).toBe(p.openedAt);
    expect(revived.strike.toString()).toBe(p.strike.toString());
    expect(revived.szi.toString()).toBe(p.szi.toString());
    expect(revived.entryPx.toString()).toBe(p.entryPx.toString());
    expect(revived.marginUsed.toString()).toBe(p.marginUsed.toString());
  });

  it('preserves precision for fractional premiums', () => {
    const p = makePos({
      strike: new Decimal('400.5'),
      entryPx: new Decimal('3.14159265358979'),
      szi: new Decimal('2'),
      marginUsed: new Decimal('628.31853'),
    });
    const revived = deserializeOptionPosition(
      JSON.parse(JSON.stringify(serializeOptionPosition(p)))
    );
    expect(revived.entryPx.toString()).toBe('3.14159265358979');
    expect(revived.strike.toString()).toBe('400.5');
    expect(revived.marginUsed.toString()).toBe('628.31853');
  });

  it('preserves short position (negative szi)', () => {
    const p = makePos({ szi: new Decimal(-3) });
    const revived = deserializeOptionPosition(
      JSON.parse(JSON.stringify(serializeOptionPosition(p)))
    );
    expect(revived.szi.toString()).toBe('-3');
    expect(revived.szi.isNegative()).toBe(true);
  });
});

describe('leg math', () => {
  it('legNotional = szi * mark * 100 for long', () => {
    const p = makePos({ szi: new Decimal(2) });
    expect(legNotional(p, new Decimal(7)).toString()).toBe('1400');
  });

  it('legNotional is negative for short at positive mark', () => {
    const p = makePos({ szi: new Decimal(-2) });
    expect(legNotional(p, new Decimal(7)).toString()).toBe('-1400');
  });

  it('legCostBasis long = premium paid, positive', () => {
    const p = makePos({ szi: new Decimal(1), entryPx: new Decimal(5) });
    expect(legCostBasis(p).toString()).toBe('500');
  });

  it('legCostBasis short = premium received, negative', () => {
    const p = makePos({ szi: new Decimal(-1), entryPx: new Decimal(5) });
    expect(legCostBasis(p).toString()).toBe('-500');
  });

  it('legUnrealizedPnl long profits when mark > entry', () => {
    const p = makePos({ szi: new Decimal(1), entryPx: new Decimal(5) });
    expect(legUnrealizedPnl(p, new Decimal(7)).toString()).toBe('200');
  });

  it('legUnrealizedPnl long loses when mark < entry', () => {
    const p = makePos({ szi: new Decimal(1), entryPx: new Decimal(5) });
    expect(legUnrealizedPnl(p, new Decimal(3)).toString()).toBe('-200');
  });

  it('legUnrealizedPnl short profits when mark < entry', () => {
    const p = makePos({ szi: new Decimal(-1), entryPx: new Decimal(5) });
    expect(legUnrealizedPnl(p, new Decimal(3)).toString()).toBe('200');
  });

  it('legUnrealizedPnl short loses when mark > entry', () => {
    const p = makePos({ szi: new Decimal(-1), entryPx: new Decimal(5) });
    expect(legUnrealizedPnl(p, new Decimal(7)).toString()).toBe('-200');
  });

  it('legUnrealizedPnl scales with qty', () => {
    const p = makePos({ szi: new Decimal(3), entryPx: new Decimal(5) });
    expect(legUnrealizedPnl(p, new Decimal(6)).toString()).toBe('300');
  });
});

describe('groupBySpread', () => {
  it('groups legs sharing a spreadId', () => {
    const legs = [
      makePos({ id: 'a', spreadId: 'sp-1' }),
      makePos({ id: 'b', spreadId: 'sp-1', strike: new Decimal(410) }),
      makePos({ id: 'c', spreadId: 'sp-2' }),
    ];
    const groups = groupBySpread(legs);
    expect(groups.size).toBe(2);
    expect(groups.get('sp-1')!.map(l => l.id)).toEqual(['a', 'b']);
    expect(groups.get('sp-2')!.map(l => l.id)).toEqual(['c']);
  });

  it('returns empty map on empty input', () => {
    expect(groupBySpread([]).size).toBe(0);
  });
});

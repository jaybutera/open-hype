import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { applyFill, computeUnrealizedPnl, computeLiquidationPrice, type PaperPosition } from '../positions.ts';

const leverage = 10;

function makePos(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    coin: 'BTC',
    szi: new Decimal('1'),
    entryPx: new Decimal('50000'),
    unrealizedPnl: new Decimal(0),
    realizedPnl: new Decimal(0),
    marginUsed: new Decimal('5000'),
    ...overrides,
  };
}

describe('applyFill - open new position', () => {
  it('opens a long position', () => {
    const result = applyFill(null, 'BTC', 'buy', new Decimal('0.5'), new Decimal('50000'), leverage);
    expect(result.position).not.toBeNull();
    expect(result.position!.szi.toString()).toBe('0.5');
    expect(result.position!.entryPx.toString()).toBe('50000');
    expect(result.position!.marginUsed.toString()).toBe('2500'); // 0.5 * 50000 / 10
    expect(result.realizedPnl.toString()).toBe('0');
  });

  it('opens a short position', () => {
    const result = applyFill(null, 'ETH', 'sell', new Decimal('10'), new Decimal('3000'), leverage);
    expect(result.position!.szi.toString()).toBe('-10');
    expect(result.position!.entryPx.toString()).toBe('3000');
  });
});

describe('applyFill - add to position', () => {
  it('adds to long with weighted average entry', () => {
    const pos = makePos({ szi: new Decimal('1'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'buy', new Decimal('1'), new Decimal('52000'), leverage);
    expect(result.position!.szi.toString()).toBe('2');
    // Weighted avg: (50000*1 + 52000*1) / 2 = 51000
    expect(result.position!.entryPx.toString()).toBe('51000');
    expect(result.realizedPnl.toString()).toBe('0');
  });

  it('adds to short with weighted average entry', () => {
    const pos = makePos({ szi: new Decimal('-2'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'sell', new Decimal('1'), new Decimal('52000'), leverage);
    expect(result.position!.szi.toString()).toBe('-3');
    // (50000*2 + 52000*1) / 3 = 50666.666...
    expect(result.position!.entryPx.toFixed(2)).toBe('50666.67');
  });
});

describe('applyFill - partial close', () => {
  it('partially closes long with profit', () => {
    const pos = makePos({ szi: new Decimal('2'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'sell', new Decimal('1'), new Decimal('55000'), leverage);
    expect(result.position!.szi.toString()).toBe('1');
    expect(result.position!.entryPx.toString()).toBe('50000'); // entry unchanged
    // PnL: (55000 - 50000) * 1 = 5000
    expect(result.realizedPnl.toString()).toBe('5000');
  });

  it('partially closes long with loss', () => {
    const pos = makePos({ szi: new Decimal('2'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'sell', new Decimal('1'), new Decimal('48000'), leverage);
    expect(result.realizedPnl.toString()).toBe('-2000');
    expect(result.position!.szi.toString()).toBe('1');
  });

  it('partially closes short with profit', () => {
    const pos = makePos({ szi: new Decimal('-3'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'buy', new Decimal('1'), new Decimal('48000'), leverage);
    // Short profit: (50000 - 48000) * 1 = 2000
    expect(result.realizedPnl.toString()).toBe('2000');
    expect(result.position!.szi.toString()).toBe('-2');
  });
});

describe('applyFill - full close', () => {
  it('fully closes long', () => {
    const pos = makePos({ szi: new Decimal('1'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'sell', new Decimal('1'), new Decimal('55000'), leverage);
    expect(result.position).toBeNull();
    expect(result.realizedPnl.toString()).toBe('5000');
  });

  it('fully closes short', () => {
    const pos = makePos({ szi: new Decimal('-1'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'buy', new Decimal('1'), new Decimal('48000'), leverage);
    expect(result.position).toBeNull();
    expect(result.realizedPnl.toString()).toBe('2000');
  });
});

describe('applyFill - flip position', () => {
  it('flips long to short', () => {
    const pos = makePos({ szi: new Decimal('1'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'sell', new Decimal('3'), new Decimal('55000'), leverage);
    // Close 1 long at 55000: PnL = 5000
    // Open 2 short at 55000
    expect(result.realizedPnl.toString()).toBe('5000');
    expect(result.position!.szi.toString()).toBe('-2');
    expect(result.position!.entryPx.toString()).toBe('55000');
  });

  it('flips short to long', () => {
    const pos = makePos({ szi: new Decimal('-1'), entryPx: new Decimal('50000') });
    const result = applyFill(pos, 'BTC', 'buy', new Decimal('2'), new Decimal('48000'), leverage);
    // Close 1 short at 48000: PnL = 2000
    // Open 1 long at 48000
    expect(result.realizedPnl.toString()).toBe('2000');
    expect(result.position!.szi.toString()).toBe('1');
    expect(result.position!.entryPx.toString()).toBe('48000');
  });
});

describe('computeUnrealizedPnl', () => {
  it('long in profit', () => {
    const pos = makePos({ szi: new Decimal('2'), entryPx: new Decimal('50000') });
    const pnl = computeUnrealizedPnl(pos, new Decimal('52000'));
    expect(pnl.toString()).toBe('4000'); // 2 * (52000 - 50000)
  });

  it('long at loss', () => {
    const pos = makePos({ szi: new Decimal('1'), entryPx: new Decimal('50000') });
    const pnl = computeUnrealizedPnl(pos, new Decimal('49000'));
    expect(pnl.toString()).toBe('-1000');
  });

  it('short in profit', () => {
    const pos = makePos({ szi: new Decimal('-1'), entryPx: new Decimal('50000') });
    const pnl = computeUnrealizedPnl(pos, new Decimal('48000'));
    expect(pnl.toString()).toBe('2000'); // -1 * (48000 - 50000)
  });

  it('short at loss', () => {
    const pos = makePos({ szi: new Decimal('-1'), entryPx: new Decimal('50000') });
    const pnl = computeUnrealizedPnl(pos, new Decimal('52000'));
    expect(pnl.toString()).toBe('-2000');
  });
});

describe('computeLiquidationPrice', () => {
  it('returns null for zero position', () => {
    const pos = makePos({ szi: new Decimal(0) });
    expect(computeLiquidationPrice(pos, new Decimal('10000'), new Decimal('0.05'))).toBeNull();
  });

  it('computes liq price for long', () => {
    const pos = makePos({ szi: new Decimal('1'), entryPx: new Decimal('50000') });
    const liq = computeLiquidationPrice(pos, new Decimal('5000'), new Decimal('0.05'));
    // liqPx = 50000 - (5000 * 0.95) / 1 = 50000 - 4750 = 45250
    expect(liq!.toString()).toBe('45250');
  });

  it('computes liq price for short', () => {
    const pos = makePos({ szi: new Decimal('-1'), entryPx: new Decimal('50000') });
    const liq = computeLiquidationPrice(pos, new Decimal('5000'), new Decimal('0.05'));
    // liqPx = 50000 + (5000 * 0.95) / 1 = 50000 + 4750 = 54750
    expect(liq!.toString()).toBe('54750');
  });
});

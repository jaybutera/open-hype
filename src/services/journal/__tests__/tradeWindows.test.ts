import { describe, it, expect } from 'vitest';
import { buildTradeWindows, attachNotes } from '../tradeWindows.ts';
import type { LedgerEntry } from '../../../engine/paper/ledger.ts';
import type { JournalEntry } from '../../../engine/paper/persistence.ts';

function fill(p: Partial<LedgerEntry> & { id: string; timestamp: number; coin: string; side: 'buy' | 'sell'; size: string; price: string }): LedgerEntry {
  return {
    fee: '0', realizedPnl: '0', balanceAfter: '0',
    ...p,
  };
}

describe('buildTradeWindows', () => {
  it('builds a single long round-trip', () => {
    const fills = [
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
      fill({ id: '2', timestamp: 2000, coin: 'BTC', side: 'sell', size: '1', price: '110', realizedPnl: '10' }),
    ];
    const ws = buildTradeWindows(fills);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({
      coin: 'BTC', direction: 'long', entryTime: 1000, exitTime: 2000,
      entryPx: 100, exitPx: 110, realizedPnl: 10,
    });
  });

  it('leaves a still-open position with null exit', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'ETH', side: 'sell', size: '2', price: '50' }),
    ]);
    expect(ws).toHaveLength(1);
    expect(ws[0].direction).toBe('short');
    expect(ws[0].exitTime).toBeNull();
    expect(ws[0].exitPx).toBeNull();
  });

  it('scales in then fully exits as one window', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
      fill({ id: '2', timestamp: 1500, coin: 'BTC', side: 'buy', size: '1', price: '102' }),
      fill({ id: '3', timestamp: 2000, coin: 'BTC', side: 'sell', size: '2', price: '110', realizedPnl: '16' }),
    ]);
    expect(ws).toHaveLength(1);
    expect(ws[0].fills).toHaveLength(3);
    expect(ws[0].exitTime).toBe(2000);
  });

  it('splits a direction flip into two windows', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
      // sell 2: closes the +1 long and opens a -1 short
      fill({ id: '2', timestamp: 2000, coin: 'BTC', side: 'sell', size: '2', price: '110' }),
      fill({ id: '3', timestamp: 3000, coin: 'BTC', side: 'buy', size: '1', price: '105' }),
    ]);
    expect(ws).toHaveLength(2);
    expect(ws[0]).toMatchObject({ direction: 'long', entryTime: 1000, exitTime: 2000 });
    expect(ws[1]).toMatchObject({ direction: 'short', entryTime: 2000, exitTime: 3000 });
  });

  it('keeps separate coins independent', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
      fill({ id: '2', timestamp: 1100, coin: 'ETH', side: 'buy', size: '1', price: '50' }),
      fill({ id: '3', timestamp: 2000, coin: 'BTC', side: 'sell', size: '1', price: '110' }),
    ]);
    expect(ws).toHaveLength(2);
    const eth = ws.find(w => w.coin === 'ETH')!;
    expect(eth.exitTime).toBeNull();
  });

  it('excludes option fills', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC-C-100', side: 'buy', size: '1', price: '2', kind: 'option-open', spreadId: 's1' }),
    ]);
    expect(ws).toHaveLength(0);
  });
});

describe('attachNotes', () => {
  const note = (id: string, timestamp: number, coin?: string): JournalEntry => ({ id, timestamp, text: 't', coin });

  it('attaches a note inside the trade window', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
      fill({ id: '2', timestamp: 3000, coin: 'BTC', side: 'sell', size: '1', price: '110' }),
    ]);
    const { windows, looseNotes } = attachNotes(ws, [note('n1', 2000, 'BTC')]);
    expect(windows[0].notes).toHaveLength(1);
    expect(looseNotes).toHaveLength(0);
  });

  it('treats a note outside any window as loose', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
      fill({ id: '2', timestamp: 3000, coin: 'BTC', side: 'sell', size: '1', price: '110' }),
    ]);
    const { looseNotes } = attachNotes(ws, [note('n1', 5000, 'BTC')]);
    expect(looseNotes).toHaveLength(1);
  });

  it('does not attach a note to a different coin', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
      fill({ id: '2', timestamp: 3000, coin: 'BTC', side: 'sell', size: '1', price: '110' }),
    ]);
    const { windows, looseNotes } = attachNotes(ws, [note('n1', 2000, 'ETH')]);
    expect(windows[0].notes).toHaveLength(0);
    expect(looseNotes).toHaveLength(1);
  });

  it('attaches a coinless note by time alone', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
      fill({ id: '2', timestamp: 3000, coin: 'BTC', side: 'sell', size: '1', price: '110' }),
    ]);
    const { windows } = attachNotes(ws, [note('n1', 2000)]);
    expect(windows[0].notes).toHaveLength(1);
  });

  it('attaches a later note to a still-open window', () => {
    const ws = buildTradeWindows([
      fill({ id: '1', timestamp: 1000, coin: 'BTC', side: 'buy', size: '1', price: '100' }),
    ]);
    const { windows, looseNotes } = attachNotes(ws, [note('n1', 9999, 'BTC')]);
    expect(windows[0].notes).toHaveLength(1);
    expect(looseNotes).toHaveLength(0);
  });
});

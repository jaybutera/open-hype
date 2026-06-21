import Decimal from 'decimal.js';
import type { LedgerEntry } from '../../engine/paper/ledger.ts';
import type { JournalEntry } from '../../engine/paper/persistence.ts';

/**
 * A reconstructed round-trip trade: a contiguous span where a position in one
 * coin was open, from the fill that opened it (flat -> non-flat) to the fill
 * that flattened it (non-flat -> flat). Built purely from the ledger so that
 * journal notes can be associated by timestamp, with no stored linkage.
 */
export interface TradeWindow {
  id: string; // id of the opening fill
  coin: string;
  direction: 'long' | 'short';
  entryTime: number; // ms
  exitTime: number | null; // ms, null if still open
  entryPx: number;
  exitPx: number | null;
  realizedPnl: number;
  fills: LedgerEntry[];
  notes: JournalEntry[]; // notes whose timestamp falls within [entryTime, exitTime]
}

function isOptionFill(f: LedgerEntry): boolean {
  return f.kind === 'option-open' || f.kind === 'option-close' || f.kind === 'option-expire';
}

/**
 * Reconstruct perp round-trip trades from a fill ledger. Tracks signed size per
 * coin; a window opens when size leaves zero and closes when it returns to zero.
 * A direction flip (long straight to short) closes one window and opens another.
 * Option fills are excluded — they don't map to a single underlying price chart
 * the way perps do.
 */
export function buildTradeWindows(fills: LedgerEntry[]): TradeWindow[] {
  const perpFills = fills
    .filter(f => !isOptionFill(f))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  const windows: TradeWindow[] = [];
  // Per-coin running state for the currently-open window.
  const open = new Map<string, { size: Decimal; window: TradeWindow }>();

  for (const f of perpFills) {
    const signed = f.side === 'buy' ? new Decimal(f.size) : new Decimal(f.size).neg();
    let state = open.get(f.coin);

    if (!state) {
      // Flat -> opening a new window.
      const window: TradeWindow = {
        id: f.id,
        coin: f.coin,
        direction: signed.gt(0) ? 'long' : 'short',
        entryTime: f.timestamp,
        exitTime: null,
        entryPx: parseFloat(f.price),
        exitPx: null,
        realizedPnl: parseFloat(f.realizedPnl),
        fills: [f],
        notes: [],
      };
      windows.push(window);
      open.set(f.coin, { size: signed, window });
      continue;
    }

    state.window.fills.push(f);
    state.window.realizedPnl += parseFloat(f.realizedPnl);
    const newSize = state.size.plus(signed);

    if (newSize.isZero()) {
      // Closed flat.
      state.window.exitTime = f.timestamp;
      state.window.exitPx = parseFloat(f.price);
      open.delete(f.coin);
    } else if (newSize.s !== state.size.s && !state.size.isZero()) {
      // Direction flip: close current window at this fill, open a fresh one.
      state.window.exitTime = f.timestamp;
      state.window.exitPx = parseFloat(f.price);
      const window: TradeWindow = {
        id: f.id,
        coin: f.coin,
        direction: newSize.gt(0) ? 'long' : 'short',
        entryTime: f.timestamp,
        exitTime: null,
        entryPx: parseFloat(f.price),
        exitPx: null,
        realizedPnl: 0,
        fills: [f],
        notes: [],
      };
      windows.push(window);
      open.set(f.coin, { size: newSize, window });
    } else {
      state.size = newSize;
    }
  }

  return windows;
}

/**
 * Attach journal notes to trade windows by timestamp. A note belongs to a window
 * if it shares the window's coin (or has no coin) and its timestamp falls within
 * [entryTime, exitTime] (exitTime null = still open, so any later note counts).
 * Returns the windows (mutated in place) plus the notes that matched nothing.
 */
export function attachNotes(
  windows: TradeWindow[],
  notes: JournalEntry[],
): { windows: TradeWindow[]; looseNotes: JournalEntry[] } {
  const loose: JournalEntry[] = [];

  for (const note of notes) {
    const match = windows.find(w => {
      if (note.coin && note.coin !== w.coin) return false;
      if (note.timestamp < w.entryTime) return false;
      if (w.exitTime !== null && note.timestamp > w.exitTime) return false;
      return true;
    });
    if (match) match.notes.push(note);
    else loose.push(note);
  }

  for (const w of windows) w.notes.sort((a, b) => a.timestamp - b.timestamp);
  loose.sort((a, b) => b.timestamp - a.timestamp);
  return { windows, looseNotes: loose };
}

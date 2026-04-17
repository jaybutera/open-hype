// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PnlCalendar } from '../PnlCalendar.tsx';
import { usePaperAccountsStore } from '../../../store/usePaperAccountsStore.ts';
import type { LedgerEntry, LedgerKind } from '../../../engine/paper/ledger.ts';

// --- factories ------------------------------------------------------------

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
    timestamp: o.timestamp ?? Date.now(),
    coin: o.coin ?? 'BTC',
    side: o.side ?? 'buy',
    size: o.size ?? '1',
    price: o.price ?? '0',
    fee: o.fee ?? '0',
    realizedPnl: o.realizedPnl ?? '0',
    balanceAfter: o.balanceAfter ?? '10000',
    kind: o.kind,
    spreadId: o.spreadId,
  };
}

// OCC symbols for the vertical/iron-condor/straddle fixtures.
const TSLA_C_380 = 'TSLA260417C00380000';
const TSLA_C_390 = 'TSLA260417C00390000';
const TSLA_P_370 = 'TSLA260417P00370000';
const TSLA_P_360 = 'TSLA260417P00360000';
const TSLA_C_400 = 'TSLA260417C00400000';

function seedFills(fills: LedgerEntry[]) {
  const { accounts, activeAccountId } = usePaperAccountsStore.getState();
  const next = accounts.map((a) =>
    a.id === activeAccountId ? { ...a, fills } : a,
  );
  usePaperAccountsStore.setState({ accounts: next });
}

// Pick a timestamp inside the current default-rendered month (the calendar
// opens on the current month by default). Using "day 15 at noon local time"
// sidesteps DST / month-boundary rollover.
function tsInCurrentMonth(hour = 12, minute = 0): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 15, hour, minute).getTime();
}

function currentMonthDateStr(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 15).toLocaleDateString('en-CA');
}

function clickDayCell(dateStr: string) {
  // Each day cell is a <div> containing a day-number <div> and, if the day
  // has fills, a PnL row + "N trades" label. Find the cell whose textContent
  // contains "trade" (guaranteed for the seeded day) and click it.
  const [, , dd] = dateStr.split('-');
  const dayNum = String(Number(dd));
  const candidates = screen.getAllByText(dayNum);
  for (const el of candidates) {
    const cell = el.parentElement as HTMLElement | null;
    if (cell && cell.textContent && /trade/.test(cell.textContent)) {
      fireEvent.click(cell);
      return;
    }
  }
  throw new Error(`No day cell with trades found for ${dateStr}`);
}

beforeEach(() => {
  // Reset fills to empty each test by mutating the active account directly.
  const { accounts, activeAccountId } = usePaperAccountsStore.getState();
  const next = accounts.map((a) =>
    a.id === activeAccountId ? { ...a, fills: [] as LedgerEntry[] } : a,
  );
  usePaperAccountsStore.setState({ accounts: next });
});

// --- tests ---------------------------------------------------------------

describe('PnlCalendar — spread group rendering', () => {
  it('renders a perp fill as a single row (no spread header)', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: 'BTC',
        side: 'buy',
        size: '0.1',
        price: '50000.00',
        timestamp: ts,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    // Single perp fill → asset column shows "BTC", side "BUY".
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('BUY')).toBeInTheDocument();
    // No spread header expand-caret present.
    expect(screen.queryByText(/▸/)).not.toBeInTheDocument();
    expect(screen.queryByText(/▾/)).not.toBeInTheDocument();
  });

  it('renders a single-leg option open as a single row (not grouped)', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: TSLA_C_380,
        side: 'buy',
        size: '1',
        price: '5.00',
        kind: 'option-open',
        spreadId: 'sp-solo',
        timestamp: ts,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    // Solo option fill → BTO badge, no spread caret.
    expect(screen.getByText('BTO')).toBeInTheDocument();
    expect(screen.queryByText(/▸/)).not.toBeInTheDocument();
    // Asset column uses formatContractLabel — "TSLA 4/17 $380 C".
    expect(screen.getByText(/TSLA.*\$380.*C/)).toBeInTheDocument();
  });

  it('groups a 2-leg opened spread into one header row with strategy label and net debit/credit', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
        kind: 'option-open', spreadId: 'sp-vert', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'sell', size: '1', price: '2.00',
        kind: 'option-open', spreadId: 'sp-vert', timestamp: ts,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    // Header row: "Opened <Strategy> · 2 legs · net debit $400.00"
    // (buy 6 - sell 2 = 4 net debit per share × 100 = $400.)
    // Use textContent regex — Strategy label exact wording is owned by the classifier.
    const headerRow = screen.getByTitle(/expand legs|collapse legs/i);
    expect(headerRow.textContent).toMatch(/Opened/);
    expect(headerRow.textContent).toMatch(/2 legs/);
    expect(headerRow.textContent).toMatch(/net debit \$400\.00/);
    // Caret defaults to collapsed (▸).
    expect(headerRow.textContent).toContain('▸');
  });

  it('shows "net credit" for an opened spread with positive net premium (credit spread)', () => {
    const ts = tsInCurrentMonth();
    // Short call vertical: sell 390 for $5, buy 400 for $2 → net credit 3/sh × 100 = $300
    seedFills([
      makeFill({
        coin: TSLA_C_390, side: 'sell', size: '1', price: '5.00',
        kind: 'option-open', spreadId: 'sp-credit', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_400, side: 'buy', size: '1', price: '2.00',
        kind: 'option-open', spreadId: 'sp-credit', timestamp: ts,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    const headerRow = screen.getByTitle(/expand legs|collapse legs/i);
    expect(headerRow.textContent).toMatch(/net credit \$300\.00/);
  });

  it('expands and collapses a spread to show individual leg rows on click', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
        kind: 'option-open', spreadId: 'sp-vert', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'sell', size: '1', price: '2.00',
        kind: 'option-open', spreadId: 'sp-vert', timestamp: ts,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    // Collapsed: only the header row, no leg rows yet (no "$6.00" or "$2.00" price cells).
    expect(screen.queryByText('$6.00')).not.toBeInTheDocument();
    expect(screen.queryByText('$2.00')).not.toBeInTheDocument();

    // Expand
    const headerRow = screen.getByTitle(/expand legs/i);
    fireEvent.click(headerRow);

    // Expanded: BTO for the buy leg, STO for the sell leg; price columns visible.
    expect(screen.getByText('BTO')).toBeInTheDocument();
    expect(screen.getByText('STO')).toBeInTheDocument();
    expect(screen.getByText('$6.00')).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
    // Caret flipped to down-chevron.
    const expandedHeader = screen.getByTitle(/collapse legs/i);
    expect(expandedHeader.textContent).toContain('▾');

    // Collapse again: the leg rows disappear.
    fireEvent.click(expandedHeader);
    expect(screen.queryByText('$6.00')).not.toBeInTheDocument();
    expect(screen.getByTitle(/expand legs/i)).toBeInTheDocument();
  });

  it('groups a 4-leg iron-condor close into one header with net PnL; expands to 4 leg rows', () => {
    const ts = tsInCurrentMonth();
    // Close an iron condor — 4 legs with realized PnL each.
    seedFills([
      makeFill({
        coin: TSLA_C_390, side: 'buy', size: '1', price: '1.00',
        realizedPnl: '50.00',
        kind: 'option-close', spreadId: 'sp-ic', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_400, side: 'sell', size: '1', price: '0.50',
        realizedPnl: '25.00',
        kind: 'option-close', spreadId: 'sp-ic', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_P_370, side: 'buy', size: '1', price: '1.50',
        realizedPnl: '30.00',
        kind: 'option-close', spreadId: 'sp-ic', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_P_360, side: 'sell', size: '1', price: '0.75',
        realizedPnl: '40.00',
        kind: 'option-close', spreadId: 'sp-ic', timestamp: ts,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    const headerRow = screen.getByTitle(/expand legs/i);
    expect(headerRow.textContent).toMatch(/Closed/);
    expect(headerRow.textContent).toMatch(/4 legs/);
    // Realized PnL = 50+25+30+40 = $145 → rendered as $145.00 in PnL column.
    expect(headerRow.textContent).toMatch(/\$145\.00/);
    // Lifecycle is option-close → premium label uses "net" with signed-dollar,
    // not "credit"/"debit" wording.
    expect(headerRow.textContent).not.toMatch(/net debit|net credit/);

    // Expand and verify 4 leg badges.
    fireEvent.click(headerRow);
    // BTC (buy to close) for the two long exits, STC (sell to close) for the two shorts.
    expect(screen.getAllByText('BTC')).toHaveLength(2);
    expect(screen.getAllByText('STC')).toHaveLength(2);
  });

  it('labels expired option-expire fills with EXP and groups them under one header', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: TSLA_C_380, side: 'sell', size: '1', price: '0.00',
        kind: 'option-expire', spreadId: 'sp-exp', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'buy', size: '1', price: '0.00',
        kind: 'option-expire', spreadId: 'sp-exp', timestamp: ts,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    const headerRow = screen.getByTitle(/expand legs/i);
    expect(headerRow.textContent).toMatch(/Expired/);
    expect(headerRow.textContent).toMatch(/2 legs/);

    fireEvent.click(headerRow);
    // Both legs of an expire lifecycle render with EXP badge.
    expect(screen.getAllByText('EXP')).toHaveLength(2);
  });

  it('keeps spreads with different spreadIds in separate groups even on the same day', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
        kind: 'option-open', spreadId: 'sp-A', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'sell', size: '1', price: '2.00',
        kind: 'option-open', spreadId: 'sp-A', timestamp: ts + 1000,
      }),
      makeFill({
        coin: TSLA_P_370, side: 'buy', size: '1', price: '3.00',
        kind: 'option-open', spreadId: 'sp-B', timestamp: ts + 2000,
      }),
      makeFill({
        coin: TSLA_P_360, side: 'sell', size: '1', price: '1.00',
        kind: 'option-open', spreadId: 'sp-B', timestamp: ts + 3000,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    // Two separate header rows with expand-legs titles.
    const headers = screen.getAllByTitle(/expand legs/i);
    expect(headers).toHaveLength(2);
  });

  it('separates open and close lifecycles of the same spreadId into different group rows', () => {
    const ts = tsInCurrentMonth();
    // Opens and closes of the same sp-X on the same day should render as 2 groups.
    seedFills([
      makeFill({
        coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
        kind: 'option-open', spreadId: 'sp-X', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'sell', size: '1', price: '2.00',
        kind: 'option-open', spreadId: 'sp-X', timestamp: ts + 1000,
      }),
      makeFill({
        coin: TSLA_C_380, side: 'sell', size: '1', price: '7.00',
        realizedPnl: '100.00',
        kind: 'option-close', spreadId: 'sp-X', timestamp: ts + 2000,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'buy', size: '1', price: '1.50',
        realizedPnl: '50.00',
        kind: 'option-close', spreadId: 'sp-X', timestamp: ts + 3000,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    const headers = screen.getAllByTitle(/expand legs/i);
    expect(headers).toHaveLength(2);
    const combined = headers.map((h) => h.textContent).join('|');
    expect(combined).toMatch(/Opened/);
    expect(combined).toMatch(/Closed/);
  });

  it('renders independent expand state for each group', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
        kind: 'option-open', spreadId: 'sp-A', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'sell', size: '1', price: '2.00',
        kind: 'option-open', spreadId: 'sp-A', timestamp: ts + 1000,
      }),
      makeFill({
        coin: TSLA_P_370, side: 'buy', size: '1', price: '3.00',
        kind: 'option-open', spreadId: 'sp-B', timestamp: ts + 2000,
      }),
      makeFill({
        coin: TSLA_P_360, side: 'sell', size: '1', price: '1.00',
        kind: 'option-open', spreadId: 'sp-B', timestamp: ts + 3000,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    // Expand only the first group.
    const headers = screen.getAllByTitle(/expand legs/i);
    fireEvent.click(headers[0]);

    // Now there's 1 expanded header and 1 still-collapsed header.
    expect(screen.getAllByTitle(/collapse legs/i)).toHaveLength(1);
    expect(screen.getAllByTitle(/expand legs/i)).toHaveLength(1);

    // Expanded first group shows its price column; second group's prices stay hidden.
    expect(screen.getByText('$6.00')).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
    expect(screen.queryByText('$3.00')).not.toBeInTheDocument();
    expect(screen.queryByText('$1.00')).not.toBeInTheDocument();
  });

  it('renders a mixed day (perp single + option spread) with correct row ordering', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: 'BTC', side: 'buy', size: '0.1', price: '50000',
        timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
        kind: 'option-open', spreadId: 'sp-mix', timestamp: ts + 1000,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'sell', size: '1', price: '2.00',
        kind: 'option-open', spreadId: 'sp-mix', timestamp: ts + 2000,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    // BTC single row is present.
    expect(screen.getByText('BTC')).toBeInTheDocument();
    // Spread header is present.
    const headerRow = screen.getByTitle(/expand legs/i);
    expect(headerRow.textContent).toMatch(/Opened/);
    // One spread group only.
    expect(screen.getAllByTitle(/expand legs/i)).toHaveLength(1);
  });

  it('shows em-dash ("-") instead of $0.00 PnL on an opened-spread header row', () => {
    const ts = tsInCurrentMonth();
    seedFills([
      makeFill({
        coin: TSLA_C_380, side: 'buy', size: '1', price: '6.00',
        kind: 'option-open', spreadId: 'sp-open', timestamp: ts,
      }),
      makeFill({
        coin: TSLA_C_390, side: 'sell', size: '1', price: '2.00',
        kind: 'option-open', spreadId: 'sp-open', timestamp: ts + 1000,
      }),
    ]);

    render(<PnlCalendar />);
    clickDayCell(currentMonthDateStr());

    const headerRow = screen.getByTitle(/expand legs/i);
    // The PnL cell for an opened spread shows em-dash (opens have no realized PnL).
    const cells = within(headerRow).getAllByRole('cell');
    // Last cell is the PnL column.
    const pnlCell = cells[cells.length - 1];
    expect(pnlCell.textContent).toBe('-');
  });
});

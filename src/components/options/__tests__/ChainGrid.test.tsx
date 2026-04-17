// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ChainGrid } from '../ChainGrid.tsx';
import type { Leg, OptionChain, OptionContract, OptionType } from '../../../services/options/types.ts';

function contract(partial: Partial<OptionContract> & { type: OptionType; strike: number }): OptionContract {
  const typeChar = partial.type === 'call' ? 'C' : 'P';
  return {
    symbol: `T${typeChar}${partial.strike}`,
    underlying: 'T',
    expiration: 1_800_000_000,
    bid: 1.0,
    ask: 1.1,
    last: 1.05,
    iv: 0.3,
    volume: 0,
    openInterest: 0,
    inTheMoney: false,
    ...partial,
  };
}

function leg(side: 'buy' | 'sell', c: OptionContract, qty = 1): Leg {
  return { side, contract: c, qty };
}

function chainOf(calls: OptionContract[], puts: OptionContract[], underlyingPrice = 100): OptionChain {
  const strikes = Array.from(new Set([...calls, ...puts].map((c) => c.strike))).sort((a, b) => a - b);
  return {
    underlying: 'T',
    underlyingPrice,
    expirations: [1_800_000_000],
    strikes,
    calls,
    puts,
    loadedExpiration: 1_800_000_000,
    asOf: 1_700_000_000,
  };
}

beforeEach(() => {
  // Reset per-test localStorage so `loadChainMetrics()` always picks defaults.
  window.localStorage.clear();
});

describe('ChainGrid — cell click → leg toggle', () => {
  it('calls onCellClick with (contract, "sell") when a call bid cell is clicked', () => {
    const call = contract({ type: 'call', strike: 100, bid: 2.5, ask: 2.6 });
    const put = contract({ type: 'put', strike: 100, bid: 1.5, ask: 1.6 });
    const chain = chainOf([call], [put]);
    const onCellClick = vi.fn();

    render(<ChainGrid chain={chain} legs={[]} onCellClick={onCellClick} />);

    // Call bid cell: interactive, title "Sell call @ bid 2.50"
    const sellCallCell = screen.getByTitle(/Sell call @ bid 2\.50/);
    fireEvent.click(sellCallCell);

    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onCellClick).toHaveBeenCalledWith(call, 'sell');
  });

  it('calls onCellClick with (contract, "buy") when a call ask cell is clicked', () => {
    const call = contract({ type: 'call', strike: 100, bid: 2.5, ask: 2.6 });
    const chain = chainOf([call], []);
    const onCellClick = vi.fn();

    render(<ChainGrid chain={chain} legs={[]} onCellClick={onCellClick} />);

    const buyCallCell = screen.getByTitle(/Buy call @ ask 2\.60/);
    fireEvent.click(buyCallCell);

    expect(onCellClick).toHaveBeenCalledWith(call, 'buy');
  });

  it('calls onCellClick with ("sell") for a put bid and ("buy") for a put ask', () => {
    const put = contract({ type: 'put', strike: 100, bid: 3.2, ask: 3.4 });
    const chain = chainOf([], [put]);
    const onCellClick = vi.fn();

    render(<ChainGrid chain={chain} legs={[]} onCellClick={onCellClick} />);

    fireEvent.click(screen.getByTitle(/Sell put @ bid 3\.20/));
    fireEvent.click(screen.getByTitle(/Buy put @ ask 3\.40/));

    expect(onCellClick).toHaveBeenNthCalledWith(1, put, 'sell');
    expect(onCellClick).toHaveBeenNthCalledWith(2, put, 'buy');
  });

  it('does not call onCellClick when bid is 0 (non-interactive)', () => {
    // 75/183 TSLA calls had bid=0 in the fixture — these cells are intentionally inert.
    const call = contract({ type: 'call', strike: 100, bid: 0, ask: 2.6 });
    const chain = chainOf([call], []);
    const onCellClick = vi.fn();

    const { container } = render(
      <ChainGrid chain={chain} legs={[]} onCellClick={onCellClick} />,
    );

    // No "Sell call @ bid" tooltip because bid is 0 → cell is not interactive.
    expect(screen.queryByTitle(/Sell call @ bid/)).toBeNull();

    // Click the dash cell anyway; confirm no-op.
    const dashCells = container.querySelectorAll('td');
    dashCells.forEach((td) => {
      if (td.textContent === '—') fireEvent.click(td);
    });
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it('renders the 4-leg cap banner only when legs.length >= MAX_LEGS', () => {
    const call = contract({ type: 'call', strike: 100, bid: 2, ask: 2.1 });
    const chain = chainOf([call], []);
    const bannerText = /4-leg cap reached/i;

    const { rerender } = render(
      <ChainGrid chain={chain} legs={[]} onCellClick={vi.fn()} />,
    );
    expect(screen.queryByText(bannerText)).toBeNull();

    const c1 = contract({ type: 'call', strike: 100 });
    const c2 = contract({ type: 'call', strike: 101 });
    const c3 = contract({ type: 'call', strike: 102 });
    const c4 = contract({ type: 'call', strike: 103 });
    const fullLegs: Leg[] = [leg('buy', c1), leg('buy', c2), leg('buy', c3), leg('buy', c4)];

    rerender(<ChainGrid chain={chain} legs={fullLegs} onCellClick={vi.fn()} />);
    expect(screen.getByText(bannerText)).toBeInTheDocument();
  });

  it('keeps already-selected cells interactive at the cap (for removal/flip)', () => {
    const call100 = contract({ type: 'call', strike: 100, bid: 2, ask: 2.1 });
    // An "uninvolved" strike — no legs reference this one, so at the cap
    // its bid/ask cells are non-interactive and surface the cap-msg tooltip.
    const callOutsider = contract({ type: 'call', strike: 120, bid: 0.5, ask: 0.6 });
    const otherCalls = [101, 102, 103].map((s) =>
      contract({ type: 'call', strike: s, bid: 1, ask: 1.1 }),
    );
    const chain = chainOf([call100, callOutsider, ...otherCalls], []);
    const onCellClick = vi.fn();

    // At cap: 4 legs, one of which is the call100 bid (selected-sell).
    const legs: Leg[] = [
      leg('sell', call100),
      leg('buy', otherCalls[0]),
      leg('buy', otherCalls[1]),
      leg('buy', otherCalls[2]),
    ];

    render(<ChainGrid chain={chain} legs={legs} onCellClick={onCellClick} />);

    // Selected bid cell on call100: still interactive (can click to remove).
    const selectedCell = screen.getByTitle(/Sell call @ bid 2\.00/);
    fireEvent.click(selectedCell);
    expect(onCellClick).toHaveBeenCalledWith(call100, 'sell');

    // The outsider-strike's cells are inert at the cap.
    onCellClick.mockClear();
    const cappedCells = screen.getAllByTitle('At 4-leg cap — remove a leg first');
    expect(cappedCells.length).toBeGreaterThan(0);
    fireEvent.click(cappedCells[0]);
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it('renders an empty-chain placeholder when no strikes are present', () => {
    const chain = chainOf([], []);
    render(<ChainGrid chain={chain} legs={[]} onCellClick={vi.fn()} />);
    expect(screen.getByText(/No strikes available/i)).toBeInTheDocument();
  });

  it('sorts strike rows ascending and renders the strike column', () => {
    const c1 = contract({ type: 'call', strike: 110 });
    const c2 = contract({ type: 'call', strike: 95 });
    const c3 = contract({ type: 'call', strike: 100 });
    const chain = chainOf([c1, c2, c3], []);

    const { container } = render(
      <ChainGrid chain={chain} legs={[]} onCellClick={vi.fn()} />,
    );

    const strikeCells = Array.from(container.querySelectorAll('tbody tr')).map((tr) => {
      // Strike cell is the 5th td (center column).
      const tds = tr.querySelectorAll('td');
      return tds[4]?.textContent?.trim();
    });
    expect(strikeCells).toEqual(['95', '100', '110']);
  });
});

describe('ChainGrid — metric picker', () => {
  it('toggles active state on a metric chip when clicked', () => {
    const call = contract({ type: 'call', strike: 100, bid: 2, ask: 2.1, openInterest: 500 });
    const chain = chainOf([call], []);

    const { container } = render(
      <ChainGrid chain={chain} legs={[]} onCellClick={vi.fn()} />,
    );

    // Default metrics are IV + OI. Volume chip should start inactive.
    const volChip = within(container).getByRole('button', { name: /Vol/i });
    // Inactive → transparent bg, muted color. Active → brand blue tint + white text.
    expect(volChip.style.color).toBe('rgb(138, 143, 152)');

    fireEvent.click(volChip);
    expect(volChip.style.color).toBe('rgb(225, 228, 232)');
  });
});

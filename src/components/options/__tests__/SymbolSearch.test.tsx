// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { SymbolSearch } from '../SymbolSearch.tsx';

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SymbolSearch', () => {
  it('renders the placeholder for an unset value', () => {
    render(<SymbolSearch value={null} onChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText(/Search symbol \(e\.g\. TSLA, SPY\)/),
    ).toBeInTheDocument();
  });

  it('shows the current value as placeholder when set', () => {
    render(<SymbolSearch value="TSLA" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('TSLA')).toBeInTheDocument();
  });

  it('does not open the dropdown before focus', () => {
    render(<SymbolSearch value={null} onChange={vi.fn()} />);
    // Dropdown items rely on the hits having a "Free-form" label; absent when closed.
    expect(screen.queryByText('Free-form')).not.toBeInTheDocument();
  });

  it('debounces input changes by 300ms before filtering hits', () => {
    render(<SymbolSearch value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'TSL' } });

    // Before debounce fires, no TSLA entry is rendered in the dropdown.
    expect(screen.queryByText('TSLA')).not.toBeInTheDocument();

    advance(299);
    expect(screen.queryByText('TSLA')).not.toBeInTheDocument();

    advance(1); // 300ms total -> debounce fires
    expect(screen.getByText('TSLA')).toBeInTheDocument();
    expect(screen.getByText('Tesla Inc.')).toBeInTheDocument();
  });

  it('resets the debounce when typing continues within 300ms', () => {
    render(<SymbolSearch value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'TS' } });
    advance(200);
    fireEvent.change(input, { target: { value: 'TSLA' } });
    advance(200); // 200 after second keystroke, total 400ms — first debounce canceled
    // Still no hit: the second change scheduled a fresh 300ms timer at t=200; we're at t=400
    // That means the new debounce fires at t=500. We've only advanced 200ms since the 2nd change.
    expect(screen.queryByText('Tesla Inc.')).not.toBeInTheDocument();

    advance(100); // 300ms after the 2nd change
    expect(screen.getByText('Tesla Inc.')).toBeInTheDocument();
  });

  it('commits the clicked hit via onChange and upper-cases the symbol', () => {
    const onChange = vi.fn();
    render(<SymbolSearch value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'tsla' } });
    advance(300);

    const row = screen.getByText('TSLA');
    fireEvent.mouseDown(row);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('TSLA');
  });

  it('commits via Enter key when hits exist (picks the active row)', () => {
    const onChange = vi.fn();
    render(<SymbolSearch value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'TSLA' } });
    advance(300);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('TSLA');
  });

  it('prepends a free-form row when the query has no exact hit', () => {
    const onChange = vi.fn();
    render(<SymbolSearch value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ZZZZ' } });
    advance(300);

    // ZZZZ row present with 'Free-form' secondary label
    expect(screen.getByText('ZZZZ')).toBeInTheDocument();
    expect(screen.getByText('Free-form')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('ZZZZ');
  });

  it('Escape closes the dropdown without committing', () => {
    const onChange = vi.fn();
    render(<SymbolSearch value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'TSLA' } });
    advance(300);
    expect(screen.getByText('Tesla Inc.')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('Tesla Inc.')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ArrowDown opens the dropdown and moves the active row down', () => {
    const { container } = render(<SymbolSearch value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'TSL' } });
    advance(300);

    // Query yields at least 2 hits. Find all symbol rows (the hit `<div>`s have
    // background = 'transparent' or 'rgb(26, 31, 46)' — they're the interactive rows).
    const allRows = Array.from(
      container.querySelectorAll<HTMLDivElement>('div[style*="cursor: pointer"]'),
    );
    expect(allRows.length).toBeGreaterThanOrEqual(2);

    // Initially row 0 is active.
    expect(allRows[0].style.background).toBe('rgb(26, 31, 46)');
    expect(allRows[1].style.background).toBe('transparent');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(allRows[0].style.background).toBe('transparent');
    expect(allRows[1].style.background).toBe('rgb(26, 31, 46)');
  });

  it('lists recent symbols first when query is empty', () => {
    // Seed recents directly via localStorage.
    window.localStorage.setItem(
      'hl-options-recent-symbols',
      JSON.stringify(['TSLA', 'AAPL']),
    );

    render(<SymbolSearch value={null} onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);

    // "Recent" header pill + per-row secondary label "Recent" + per-row right-side
    // "Recent" badge → 1 header + 2 rows × 2 = 5.
    expect(screen.getAllByText('Recent').length).toBe(5);
    // Only TSLA and AAPL are listed (popular-hit rows are absent on empty query).
    expect(screen.getByText('TSLA')).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
  });

  it('persists the committed symbol to the recents localStorage list', () => {
    const onChange = vi.fn();
    render(<SymbolSearch value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'NVDA' } });
    advance(300);

    const row = screen.getByText('NVDA');
    fireEvent.mouseDown(row);

    const stored = window.localStorage.getItem('hl-options-recent-symbols');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual(['NVDA']);
  });

  it('clears the query after a successful commit', () => {
    const onChange = vi.fn();
    render(<SymbolSearch value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Search symbol/) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'tsla' } });
    advance(300);

    fireEvent.mouseDown(screen.getByText('TSLA'));
    expect(input.value).toBe('');
  });

  it('is disabled when the disabled prop is true', () => {
    render(<SymbolSearch value={null} onChange={vi.fn()} disabled />);
    const input = screen.getByPlaceholderText(/Search symbol/) as HTMLInputElement;
    expect(input).toBeDisabled();

    // Dropdown never opens on focus when disabled (input is inert too).
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'TSLA' } });
    advance(300);
    expect(screen.queryByText('Tesla Inc.')).not.toBeInTheDocument();
  });

  it('free-form Enter commits the typed query when no hits exist', () => {
    // Use a query that matches nothing in POPULAR_SYMBOLS by symbol, substring, or name.
    const onChange = vi.fn();
    render(<SymbolSearch value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Search symbol/);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzzqqq' } });
    advance(300);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('ZZZQQQ');
  });
});

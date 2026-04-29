// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Decimal from 'decimal.js';
import { PositionsOptions } from '../PositionsOptions.tsx';
import { useAccountStore } from '../../../store/useAccountStore.ts';
import type { PaperEngine } from '../../../engine/paper/PaperEngine.ts';
import type {
  OptionPositionJSON,
} from '../../../engine/paper/options/OptionPosition.ts';
import type { OptionChain, OptionContract, OptionType } from '../../../services/options/types.ts';

// --- factories ------------------------------------------------------------

interface LegJSONInput {
  id: string;
  spreadId: string;
  type: OptionType;
  strike: number | string;
  szi: number | string;
  entryPx: number | string;
  underlying?: string;
  contractSymbol?: string;
  expiration?: number;
  marginUsed?: string;
  openedAt?: number;
}

function legJSON(partial: LegJSONInput): OptionPositionJSON {
  const strike = typeof partial.strike === 'number' ? partial.strike.toString() : partial.strike;
  const szi = typeof partial.szi === 'number' ? partial.szi.toString() : partial.szi;
  const entryPx = typeof partial.entryPx === 'number' ? partial.entryPx.toString() : partial.entryPx;
  const underlying = partial.underlying ?? 'T';
  const typeChar = partial.type === 'call' ? 'C' : 'P';
  return {
    id: partial.id,
    spreadId: partial.spreadId,
    contractSymbol: partial.contractSymbol ?? `${underlying}${typeChar}${strike}`,
    underlying,
    type: partial.type,
    strike,
    expiration: partial.expiration ?? 1_800_000_000,
    szi,
    entryPx,
    marginUsed: partial.marginUsed ?? '0',
    openedAt: partial.openedAt ?? 1_700_000_000,
  };
}

function contract(partial: Partial<OptionContract> & { type: OptionType; strike: number }): OptionContract {
  const typeChar = partial.type === 'call' ? 'C' : 'P';
  return {
    type: partial.type,
    strike: partial.strike,
    symbol: partial.symbol ?? `T${typeChar}${partial.strike}`,
    underlying: partial.underlying ?? 'T',
    expiration: partial.expiration ?? 1_800_000_000,
    bid: partial.bid ?? 1.0,
    ask: partial.ask ?? 1.1,
    last: partial.last ?? 1.05,
    iv: partial.iv ?? 0.3,
    volume: partial.volume ?? 0,
    openInterest: partial.openInterest ?? 0,
    inTheMoney: partial.inTheMoney ?? false,
  };
}

function chainOf(
  calls: OptionContract[],
  puts: OptionContract[],
  underlying = 'T',
  underlyingPrice = 100,
): OptionChain {
  const strikes = Array.from(new Set([...calls, ...puts].map((c) => c.strike))).sort((a, b) => a - b);
  return {
    underlying,
    underlyingPrice,
    expirations: [1_800_000_000],
    strikes,
    calls,
    puts,
    loadedExpiration: 1_800_000_000,
    asOf: 1_700_000_000,
  };
}

// A fake engine that records closeOptionSpread calls. Only this method is
// invoked by the component.
function fakeEngine(options?: {
  result?: Parameters<PaperEngine['closeOptionSpread']> extends unknown[]
    ? ReturnType<PaperEngine['closeOptionSpread']>
    : never;
}) {
  const closeOptionSpread = vi.fn((
    _spreadId: string,
    _contracts: OptionContract[],
    _opts?: { fillModel?: 'mid' | 'cross' },
  ) => options?.result ?? {
    success: true as const,
    realizedPnl: new Decimal(50),
    closedLegs: 1,
  });
  return { closeOptionSpread } as unknown as PaperEngine;
}

beforeEach(() => {
  useAccountStore.setState({ paperOptionPositions: [] });
});

describe('PositionsOptions', () => {
  it('renders the empty state when there are no option positions', () => {
    render(<PositionsOptions chain={null} engine={fakeEngine()} marketOpen={true} />);
    expect(screen.getByText(/no open option positions/i)).toBeInTheDocument();
    // Header should NOT be rendered in the empty state.
    expect(screen.queryByText(/open option positions \(/i)).not.toBeInTheDocument();
  });

  it('renders a spread header with strategy label, count, and DTE when positions exist', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });

    render(<PositionsOptions chain={null} engine={fakeEngine()} marketOpen={true} />);

    expect(screen.getByText(/open option positions \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('T')).toBeInTheDocument();
    // 1-leg long call → strategy "Long Call", leg count "1 leg"
    expect(screen.getByText(/Long Call\s*·\s*1 leg/)).toBeInTheDocument();
  });

  it('shows Debit for a long (entry = +$200) and em-dash for mark/PnL when chain is absent', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });

    const { container } = render(
      <PositionsOptions chain={null} engine={fakeEngine()} marketOpen={true} />,
    );

    // Entry = szi × entryPx × 100 = 1 × 2 × 100 = 200 (positive = Debit)
    expect(container.textContent).toMatch(/Debit\s*\$200\.00/);
  });

  it('shows Credit for a short leg with entry = -$300', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'put', strike: 100, szi: -1, entryPx: 3 }),
      ],
    });

    const { container } = render(
      <PositionsOptions chain={null} engine={fakeEngine()} marketOpen={true} />,
    );

    expect(container.textContent).toMatch(/Credit\s*\$300\.00/);
  });

  it('expands to show leg detail rows when the spread header is clicked', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
        legJSON({ id: 'l2', spreadId: 's1', type: 'call', strike: 110, szi: -1, entryPx: 1 }),
      ],
    });

    render(<PositionsOptions chain={null} engine={fakeEngine()} marketOpen={true} />);

    // Before expanding, leg details ("LONG 1" / "SHORT 1" badges) aren't rendered.
    expect(screen.queryByText(/LONG 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SHORT 1/)).not.toBeInTheDocument();

    // Click the spread header row (it contains the strategy label).
    const strategyCell = screen.getByText(/Call Vertical\s*·\s*2 legs/);
    fireEvent.click(strategyCell);

    expect(screen.getByText(/LONG 1/)).toBeInTheDocument();
    expect(screen.getByText(/SHORT 1/)).toBeInTheDocument();
    // Chain isn't matched, so the "load chain" hint appears in the expanded body.
    expect(screen.getByText(/Load T's chain above to see live marks/i)).toBeInTheDocument();
  });

  it('collapses again when the header is clicked a second time', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });

    render(<PositionsOptions chain={null} engine={fakeEngine()} marketOpen={true} />);

    const header = screen.getByText(/Long Call\s*·\s*1 leg/);
    fireEvent.click(header);
    expect(screen.getByText(/LONG 1/)).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByText(/LONG 1/)).not.toBeInTheDocument();
  });

  it('disables Close with the market-closed tooltip when marketOpen=false', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });
    const chain = chainOf(
      [contract({ type: 'call', strike: 100, bid: 3, ask: 3.1 })],
      [],
    );

    render(<PositionsOptions chain={chain} engine={fakeEngine()} marketOpen={false} />);

    const btn = screen.getByRole('button', { name: /close/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/market closed/i);
  });

  it('disables Close with the load-chain tooltip when chain underlying does not match', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({
          id: 'l1',
          spreadId: 's1',
          type: 'call',
          strike: 100,
          szi: 1,
          entryPx: 2,
          underlying: 'AAPL',
          contractSymbol: 'AAPLC100',
        }),
      ],
    });
    // Chain for T, but the leg is on AAPL.
    const chain = chainOf(
      [contract({ type: 'call', strike: 100, bid: 3, ask: 3.1 })],
      [],
    );

    render(<PositionsOptions chain={chain} engine={fakeEngine()} marketOpen={true} />);

    const btn = screen.getByRole('button', { name: /close/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/Load AAPL's chain to enable closing/i);
  });

  it('enables Close and invokes engine.closeOptionSpread with the chain contracts on click', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });
    const call = contract({ type: 'call', strike: 100, bid: 3, ask: 3.1 });
    const put = contract({ type: 'put', strike: 100, bid: 1, ask: 1.1 });
    const chain = chainOf([call], [put]);
    const engine = fakeEngine();

    render(<PositionsOptions chain={chain} engine={engine} marketOpen={true} />);

    const btn = screen.getByRole('button', { name: /close/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toMatch(/Close all legs at current mid/i);

    fireEvent.click(btn);

    expect(engine.closeOptionSpread).toHaveBeenCalledTimes(1);
    const [spreadId, contracts, opts] = (
      engine.closeOptionSpread as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, OptionContract[], { fillModel: 'mid' | 'cross' }];
    expect(spreadId).toBe('s1');
    // Calls + puts from the chain are both passed, in that order.
    expect(contracts).toEqual([call, put]);
    expect(opts).toEqual({ fillModel: 'mid' });
  });

  it('shows a success feedback line after a successful close', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });
    const chain = chainOf(
      [contract({ type: 'call', strike: 100, bid: 3, ask: 3.1 })],
      [],
    );
    const engine = fakeEngine({
      result: { success: true, realizedPnl: new Decimal(150), closedLegs: 1 },
    });

    render(<PositionsOptions chain={chain} engine={engine} marketOpen={true} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.getByText(/Closed 1 leg\s*·\s*PnL \+\$150\.00/)).toBeInTheDocument();
  });

  it('shows an error feedback line when the engine rejects the close', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });
    const chain = chainOf(
      [contract({ type: 'call', strike: 100, bid: 3, ask: 3.1 })],
      [],
    );
    const engine = fakeEngine({
      result: { success: false, error: 'No usable quote for TC100' },
    });

    render(<PositionsOptions chain={chain} engine={engine} marketOpen={true} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.getByText(/No usable quote for TC100/)).toBeInTheDocument();
  });

  it('sorts multiple spreads by earliest-opened first', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        // s2 was opened later but appears first in state
        legJSON({
          id: 'l2',
          spreadId: 's2',
          type: 'put',
          strike: 100,
          szi: -1,
          entryPx: 3,
          openedAt: 1_700_000_500,
        }),
        legJSON({
          id: 'l1',
          spreadId: 's1',
          type: 'call',
          strike: 100,
          szi: 1,
          entryPx: 2,
          openedAt: 1_700_000_100,
        }),
      ],
    });

    const { container } = render(
      <PositionsOptions chain={null} engine={fakeEngine()} marketOpen={true} />,
    );

    const headerText = container.textContent ?? '';
    const callPos = headerText.search(/Long Call\s*·\s*1 leg/);
    const putPos = headerText.search(/Short Put\s*·\s*1 leg/);
    expect(callPos).toBeGreaterThan(-1);
    expect(putPos).toBeGreaterThan(-1);
    // s1 (Long Call, openedAt 1_700_000_100) should appear before s2 (Short Put).
    expect(callPos).toBeLessThan(putPos);
  });

  it('shows live mark and signed PnL when the loaded chain matches the spread underlying', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });
    // Current mid = (3 + 3.2) / 2 = 3.10. Entry was 2.00 → PnL = +110 (1 × 1.10 × 100).
    // Mark value total = 1 × 3.10 × 100 = 310.
    const chain = chainOf(
      [contract({ type: 'call', strike: 100, bid: 3, ask: 3.2 })],
      [],
    );

    const { container } = render(
      <PositionsOptions chain={chain} engine={fakeEngine()} marketOpen={true} />,
    );

    // The PnL-column span should contain "+$110.00".
    expect(container.textContent).toMatch(/\+\$110\.00/);
    // The Mark column shows the absolute net mark total ($310.00).
    expect(container.textContent).toMatch(/\$310\.00/);
  });

  it('renders Net Greeks block in the expanded body only when chain matches', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({ id: 'l1', spreadId: 's1', type: 'call', strike: 100, szi: 1, entryPx: 2 }),
      ],
    });
    const chain = chainOf(
      [contract({ type: 'call', strike: 100, bid: 3, ask: 3.1 })],
      [],
    );

    const { container } = render(
      <PositionsOptions chain={chain} engine={fakeEngine()} marketOpen={true} />,
    );

    // Expand.
    const header = screen.getByText(/Long Call\s*·\s*1 leg/);
    fireEvent.click(header);

    // All five greek labels (Δ Γ ν Θ ρ) should be present.
    const text = container.textContent ?? '';
    expect(text).toContain('Δ');
    expect(text).toContain('Γ');
    expect(text).toContain('ν');
    expect(text).toContain('Θ');
    expect(text).toContain('ρ');
    // And the "Load X's chain above" hint should NOT be rendered (chain matches).
    expect(within(container).queryByText(/Load T's chain above/i)).not.toBeInTheDocument();
  });
});

describe('PositionsOptions — multi-underlying quotes cache', () => {
  it('renders live PnL for spreads on multiple underlyings without any chain loaded', () => {
    // Two open positions on different underlyings.
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({
          id: 'l1', spreadId: 's1', type: 'put', strike: 380, szi: -1, entryPx: 18.10,
          underlying: 'TSLA', contractSymbol: 'TSLA260529P00380000',
        }),
        legJSON({
          id: 'l2', spreadId: 's2', type: 'call', strike: 18, szi: 1, entryPx: 11.31,
          underlying: 'CIFR', contractSymbol: 'CIFR260514C00018000',
        }),
      ],
    });

    // A multi-underlying quote cache populated as the hook would have populated it.
    const tslaPut = contract({
      type: 'put', strike: 380, bid: 19.0, ask: 19.5,
      symbol: 'TSLA260529P00380000', underlying: 'TSLA',
    });
    const cifrCall = contract({
      type: 'call', strike: 18, bid: 12.0, ask: 12.4,
      symbol: 'CIFR260514C00018000', underlying: 'CIFR',
    });
    const quotes = new Map<string, OptionContract>([
      ['TSLA260529P00380000', tslaPut],
      ['CIFR260514C00018000', cifrCall],
    ]);
    const underlyingPrices = new Map<string, number>([['TSLA', 376], ['CIFR', 17]]);

    render(
      <PositionsOptions
        chain={null}
        engine={fakeEngine()}
        marketOpen={true}
        quotes={quotes}
        underlyingPrices={underlyingPrices}
      />,
    );

    // Both spreads must show numeric PnL — no em-dashes in either row.
    // TSLA short put: entryPx 18.10, mid (19.0+19.5)/2 = 19.25.
    // szi = -1, PnL = -1 * (19.25 - 18.10) * 100 = -$115.00.
    expect(screen.getByText('−$115.00')).toBeInTheDocument();
    // CIFR long call: entryPx 11.31, mid 12.20.
    // szi = +1, PnL = +1 * (12.20 - 11.31) * 100 = +$89.00.
    expect(screen.getByText('+$89.00')).toBeInTheDocument();
  });

  it('enables Close for a spread whose underlying does not match the active chain when quotes are cached', () => {
    useAccountStore.setState({
      paperOptionPositions: [
        legJSON({
          id: 'l1', spreadId: 's1', type: 'call', strike: 18, szi: 1, entryPx: 11,
          underlying: 'CIFR', contractSymbol: 'CIFR260514C00018000',
        }),
      ],
    });
    // Active chain is for TSLA — would have left CIFR uncloseable in the old flow.
    const tslaChain = chainOf([contract({ type: 'call', strike: 100, bid: 3, ask: 3.1 })], [], 'TSLA');
    const cifrCall = contract({
      type: 'call', strike: 18, bid: 12, ask: 12.4,
      symbol: 'CIFR260514C00018000', underlying: 'CIFR',
    });
    const quotes = new Map<string, OptionContract>([['CIFR260514C00018000', cifrCall]]);
    const engine = fakeEngine();

    render(
      <PositionsOptions
        chain={tslaChain}
        engine={engine}
        marketOpen={true}
        quotes={quotes}
        underlyingPrices={new Map([['CIFR', 17]])}
      />,
    );

    const btn = screen.getByRole('button', { name: /close/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(engine.closeOptionSpread).toHaveBeenCalledTimes(1);
    // Engine should have been handed the cache contracts, not the TSLA chain's.
    const [, contracts] = (
      engine.closeOptionSpread as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, OptionContract[], unknown];
    expect(contracts.map((c) => c.symbol)).toEqual(['CIFR260514C00018000']);
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetSummary } from '../NetSummary.tsx';
import type { Leg, OptionContract, OptionType } from '../../../services/options/types.ts';

function contract(partial: Partial<OptionContract> & { type: OptionType; strike: number }): OptionContract {
  return {
    symbol: `T${partial.type[0].toUpperCase()}${partial.strike}`,
    underlying: 'T',
    expiration: 1_800_000_000,
    bid: 1,
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

describe('NetSummary', () => {
  it('shows the empty-state prompt when no legs', () => {
    render(<NetSummary legs={[]} underlyingPrice={100} qtyScalar={1} />);
    expect(
      screen.getByText(/Click a bid or ask cell/i),
    ).toBeInTheDocument();
  });

  it('renders "none" breakeven for a fully-hedged flat payoff', () => {
    const c = contract({ type: 'call', strike: 100, bid: 1, ask: 1 });
    render(
      <NetSummary
        legs={[leg('buy', c), leg('sell', c)]}
        underlyingPrice={100}
        qtyScalar={1}
      />,
    );
    expect(screen.getByText('Breakeven')).toBeInTheDocument();
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('renders a single breakeven for a long call (K + premium)', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2.0, ask: 2.0 });
    render(
      <NetSummary legs={[leg('buy', c)]} underlyingPrice={100} qtyScalar={1} />,
    );
    expect(screen.getByText('$102.00')).toBeInTheDocument();
  });

  it('renders two breakevens with an em-dash for a long straddle', () => {
    const call = contract({ type: 'call', strike: 100, bid: 3.0, ask: 3.0 });
    const put = contract({ type: 'put', strike: 100, bid: 2.0, ask: 2.0 });
    render(
      <NetSummary
        legs={[leg('buy', call), leg('buy', put)]}
        underlyingPrice={100}
        qtyScalar={1}
      />,
    );
    expect(screen.getByText('$95.00 – $105.00')).toBeInTheDocument();
  });

  it('labels a net-debit position in red and a net-credit in green', () => {
    const debitCall = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const { container: debitRoot, unmount } = render(
      <NetSummary legs={[leg('buy', debitCall)]} underlyingPrice={100} qtyScalar={1} />,
    );
    expect(debitRoot.textContent).toMatch(/Net Debit/);
    unmount();

    const creditCall = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const { container: creditRoot } = render(
      <NetSummary legs={[leg('sell', creditCall)]} underlyingPrice={100} qtyScalar={1} />,
    );
    expect(creditRoot.textContent).toMatch(/Net Credit/);
  });

  it('renders all five net-greek labels', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    render(<NetSummary legs={[leg('buy', c)]} underlyingPrice={100} qtyScalar={1} />);
    expect(screen.getByText(/Delta/)).toBeInTheDocument();
    expect(screen.getByText(/Gamma/)).toBeInTheDocument();
    expect(screen.getByText(/Vega/)).toBeInTheDocument();
    expect(screen.getByText(/Theta/)).toBeInTheDocument();
    expect(screen.getByText(/Rho/)).toBeInTheDocument();
  });
});

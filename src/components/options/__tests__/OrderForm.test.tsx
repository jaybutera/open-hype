// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderForm } from '../OrderForm.tsx';
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

function noopHandlers() {
  return {
    onUpdateLeg: vi.fn(),
    onRemoveLeg: vi.fn(),
    onClear: vi.fn(),
    onSubmit: vi.fn(),
  };
}

describe('OrderForm', () => {
  it('shows the empty-state prompt and leg count 0 / 4 with no Clear button', () => {
    render(
      <OrderForm
        legs={[]}
        underlyingPrice={100}
        marketOpen={true}
        {...noopHandlers()}
      />,
    );
    expect(screen.getByText(/No legs selected/i)).toBeInTheDocument();
    expect(screen.getByText('0 / 4 legs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    // Submit button hidden when legs.length === 0
    expect(screen.queryByRole('button', { name: /open/i })).not.toBeInTheDocument();
  });

  it('submit button reads "Buy to Open" for a single long leg', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    render(
      <OrderForm
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        marketOpen={true}
        {...noopHandlers()}
      />,
    );
    expect(screen.getByRole('button', { name: /buy to open/i })).toBeInTheDocument();
    expect(screen.getByText('1 / 4 legs')).toBeInTheDocument();
  });

  it('submit button reads "Sell to Open" for a single short leg', () => {
    const c = contract({ type: 'put', strike: 100, bid: 2, ask: 2 });
    render(
      <OrderForm
        legs={[leg('sell', c)]}
        underlyingPrice={100}
        marketOpen={true}
        {...noopHandlers()}
      />,
    );
    expect(screen.getByRole('button', { name: /sell to open/i })).toBeInTheDocument();
  });

  it('submit button reads "Open Spread" for a multi-leg position', () => {
    const longCall = contract({ type: 'call', strike: 100, bid: 3, ask: 3 });
    const shortCall = contract({ type: 'call', strike: 110, bid: 1, ask: 1 });
    render(
      <OrderForm
        legs={[leg('buy', longCall), leg('sell', shortCall)]}
        underlyingPrice={100}
        marketOpen={true}
        {...noopHandlers()}
      />,
    );
    expect(screen.getByRole('button', { name: /open spread/i })).toBeInTheDocument();
    expect(screen.getByText('2 / 4 legs')).toBeInTheDocument();
  });

  it('disables submit and shows market-closed notice when market is closed', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    render(
      <OrderForm
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        marketOpen={false}
        {...noopHandlers()}
      />,
    );
    const btn = screen.getByRole('button', { name: /buy to open/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/market closed — submission disabled/i)).toBeInTheDocument();
  });

  it('fires onSubmit with the current orderType and qtyScalar when submit is clicked', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const handlers = noopHandlers();
    render(
      <OrderForm
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        marketOpen={true}
        {...handlers}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /buy to open/i }));
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
    const arg = handlers.onSubmit.mock.calls[0][0];
    expect(arg.orderType).toBe('limit');
    expect(arg.qtyScalar).toBe(1);
    // Mid of bid=ask=2 is 2 per share — default limit price.
    expect(arg.limitPrice).toBeCloseTo(2, 5);
  });

  it('Clear button fires onClear', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const handlers = noopHandlers();
    render(
      <OrderForm
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        marketOpen={true}
        {...handlers}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
  });

  it('qty scalar stepper clamps to [1, 9999] and flows into onSubmit', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const handlers = noopHandlers();
    render(
      <OrderForm
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        marketOpen={true}
        {...handlers}
      />,
    );
    // Qty × input is the one labeled "Qty ×"
    const qtyInput = screen.getByLabelText(/Qty ×/i) as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: '5' } });
    expect(qtyInput.value).toBe('5');

    fireEvent.change(qtyInput, { target: { value: '0' } });
    expect(qtyInput.value).toBe('1');

    fireEvent.change(qtyInput, { target: { value: '100000' } });
    expect(qtyInput.value).toBe('9999');

    fireEvent.click(screen.getByRole('button', { name: /buy to open/i }));
    expect(handlers.onSubmit.mock.calls[0][0].qtyScalar).toBe(9999);
  });

  it('market-order mode hides the limit input and submits with limitPrice = null', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    const handlers = noopHandlers();
    render(
      <OrderForm
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        marketOpen={true}
        {...handlers}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Type/i), { target: { value: 'market' } });
    expect(screen.queryByLabelText(/Limit \(per share/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /buy to open/i }));
    expect(handlers.onSubmit.mock.calls[0][0]).toMatchObject({
      orderType: 'market',
      limitPrice: null,
    });
  });

  it('renders the success feedback banner with status role', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    render(
      <OrderForm
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        marketOpen={true}
        feedback={{ kind: 'success', message: 'Filled at $2.00' }}
        {...noopHandlers()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Filled at $2.00');
  });

  it('renders the error feedback banner with alert role', () => {
    const c = contract({ type: 'call', strike: 100, bid: 2, ask: 2 });
    render(
      <OrderForm
        legs={[leg('buy', c)]}
        underlyingPrice={100}
        marketOpen={true}
        feedback={{ kind: 'error', message: 'Insufficient cash' }}
        {...noopHandlers()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Insufficient cash');
  });

  it('shows the strategy label in the header when legs are present', () => {
    const longCall = contract({ type: 'call', strike: 100, bid: 3, ask: 3 });
    const shortCall = contract({ type: 'call', strike: 110, bid: 1, ask: 1 });
    const { container } = render(
      <OrderForm
        legs={[leg('buy', longCall), leg('sell', shortCall)]}
        underlyingPrice={100}
        marketOpen={true}
        {...noopHandlers()}
      />,
    );
    // Verticals are classified as "Call Vertical" or "Bull Call Spread" style labels;
    // rather than hard-code which, assert the strategy separator appears.
    expect(container.textContent).toMatch(/Order\s*·\s*\S/);
  });
});

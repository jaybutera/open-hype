// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SignalPanel } from '../SignalPanel.tsx';
import { useSignalStore, resetSignalStoreForTest } from '../../../store/useSignalStore.ts';
import { useMarketStore } from '../../../store/useMarketStore.ts';
import { useTradeSetupStore } from '../../../store/useTradeSetupStore.ts';
import { signal } from '../../../test/signalFixture.ts';

beforeEach(() => {
  resetSignalStoreForTest();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('SignalPanel', () => {
  it('renders nothing without signals', () => {
    const { container } = render(<SignalPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a card per signal with levels, R and status: four at most, open plans first', () => {
    act(() => useSignalStore.getState().receive([
      signal('a', { status: 'cancelled', statusNote: 'gap inverted' }),
      signal('b'), signal('c'), signal('d', { status: 'won' }), signal('e', { status: 'filled' }),
    ]));
    render(<SignalPanel />);
    expect(screen.getAllByRole('button', { name: 'v3 xyz:SP500 short 15m' })).toHaveLength(4);
    expect(screen.getByText('+1 older')).toBeInTheDocument();
    // The cancelled one arrived first but sorts below the resting plans.
    const cards = screen.getAllByRole('button', { name: 'v3 xyz:SP500 short 15m' });
    expect(cards[0]).not.toHaveTextContent('resting');
    expect(cards[0]).toHaveAttribute('title', 'v3');
    expect(cards[2]).toHaveTextContent('filled');
    expect(cards[3]).toHaveTextContent('cancelled');
    expect(cards[3]).toHaveAttribute('title', 'v3: cancelled, gap inverted');
    expect(screen.getAllByText('2.1R')).toHaveLength(4);
  });

  it('clicking a card draws it, clears its new mark, and moves the pane to the asset', () => {
    const setAsset = vi.fn();
    const loadCandles = vi.fn(() => Promise.resolve());
    useMarketStore.setState({ setAsset, loadCandles } as never);
    act(() => useSignalStore.getState().receive([]));
    act(() => useSignalStore.getState().receive([signal('a', { asset: 'xyz:NOPE' })]));
    render(<SignalPanel />);
    expect(screen.getByTestId('signal-new')).toBeInTheDocument();
    const card = screen.getByRole('button', { name: 'v3 xyz:NOPE short 15m' });
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('signal-new')).toBeNull();
    expect(setAsset).toHaveBeenCalledWith('xyz:NOPE');
    expect(loadCandles).toHaveBeenCalled();
    fireEvent.click(card);
    expect(setAsset).toHaveBeenCalledTimes(1);
  });

  it('"set up" makes the signal one of the app\'s own setups on the pane that shows the asset', () => {
    useTradeSetupStore.setState({ activeSetups: [], pendingSetup: null });
    const asset = useMarketStore.getState().panes.primary!.asset;
    act(() => useSignalStore.getState().receive([signal('a', { asset })]));
    render(<SignalPanel />);
    fireEvent.click(screen.getByRole('button', { name: `Set up v3 ${asset} short 15m` }));
    const setups = useTradeSetupStore.getState().activeSetups;
    expect(setups).toHaveLength(1);
    expect(setups[0]).toMatchObject({ side: 'sell', asset, paneId: 'primary', entryPrice: 7609, slPrice: 7649.8, tpPrice: 7523.6 });
    expect(useTradeSetupStore.getState().pendingSetup).toBeNull();
  });
});

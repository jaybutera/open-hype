// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Wallet } from 'ethers';
import { LivePositionTable } from '../LivePositionTable.tsx';
import { ResizableBottom } from '../../layout/ResizableBottom.tsx';
import { useWalletStore } from '../../../store/useWalletStore.ts';
import { useLiveAccountStore } from '../../../store/useLiveAccountStore.ts';
import { stubHyperliquidFetch } from '../../../test/hlMocks.ts';

const user = new Wallet('0x' + '77'.repeat(32));

beforeEach(() => {
  localStorage.clear();
  useWalletStore.getState().disconnect();
  useLiveAccountStore.getState().reset();
});
afterEach(() => vi.unstubAllGlobals());

describe('LivePositionTable', () => {
  beforeEach(() => {
    stubHyperliquidFetch();
    act(() => useWalletStore.getState().connectApiKey(new Wallet('0x' + '66'.repeat(32)).privateKey, user.address));
    useLiveAccountStore.setState({
      user: user.address, accountValue: 260.896634, perpValue: 0, spotValue: 260.896634, withdrawable: 260.896634,
      perps: [{ dex: '', accountValue: 0, marginUsed: 0, withdrawable: 0 }, { dex: 'xyz', accountValue: 0, marginUsed: 0, withdrawable: 0 }],
      spotBalances: [{ coin: 'USDC', token: 0, total: 260.896634, hold: 0, usdValue: 260.896634 }],
      fillsLoaded: true,
      fills: [
        { coin: 'BTC', px: 84086, sz: 0.02806, side: 'sell', time: 1791781248930, dir: 'Close Long', closedPnl: 15.43, fee: 1.02, feeToken: 'USDC', oid: 9, tid: 2 },
        { coin: 'BTC', px: 83533, sz: 0.02806, side: 'buy', time: 1791769719620, dir: 'Open Long', closedPnl: 0, fee: 1.01, feeToken: 'USDC', oid: 8, tid: 1 },
      ],
      lastSync: Date.now(),
    });
  });

  it('summary shows the spot-inclusive account value', () => {
    render(<LivePositionTable />);
    expect(screen.getByTestId('live-account-value')).toHaveTextContent('$260.90');
  });

  it('trade history tab lists fills newest first', () => {
    render(<LivePositionTable />);
    fireEvent.click(screen.getByTestId('live-tab-history'));
    const rows = screen.getByTestId('live-history').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Close Long');
    expect(rows[0]).toHaveTextContent('$15.43');
    expect(rows[1]).toHaveTextContent('Open Long');
  });

  it('balances tab shows spot tokens and each perp dex', () => {
    render(<LivePositionTable />);
    fireEvent.click(screen.getByTestId('live-tab-balances'));
    const b = screen.getByTestId('live-balances');
    expect(b).toHaveTextContent('USDC');
    expect(b).toHaveTextContent('$260.90');
    expect(b).toHaveTextContent('Hyperliquid');
    expect(b).toHaveTextContent('xyz');
  });
});

describe('ResizableBottom', () => {
  it('drag up grows the panel, the height persists, double-click resets', () => {
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
    const { unmount } = render(<ResizableBottom><div>body</div></ResizableBottom>);
    const panel = screen.getByTestId('bottom-panel');
    expect(panel.style.height).toBe('260px');

    fireEvent.pointerDown(screen.getByTestId('bottom-resize-handle'), { clientY: 700 });
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientY: 600 })); });
    act(() => { window.dispatchEvent(new MouseEvent('pointerup')); });
    expect(panel.style.height).toBe('360px');
    expect(localStorage.getItem('hl-bottom-height')).toBe('360');

    // Cannot squeeze the chart below its minimum.
    fireEvent.pointerDown(screen.getByTestId('bottom-resize-handle'), { clientY: 600 });
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientY: 0 })); });
    act(() => { window.dispatchEvent(new MouseEvent('pointerup')); });
    expect(panel.style.height).toBe('840px');

    unmount();
    render(<ResizableBottom><div>body</div></ResizableBottom>);
    expect(screen.getByTestId('bottom-panel').style.height).toBe('840px');
    fireEvent.doubleClick(screen.getByTestId('bottom-resize-handle'));
    expect(screen.getByTestId('bottom-panel').style.height).toBe('260px');
  });
});

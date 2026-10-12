// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AiOverlayPanel } from '../AiOverlayPanel.tsx';
import { useAiOverlayStore } from '../../../store/useAiOverlayStore.ts';
import type { OverlaySet } from '../../../services/ai/types.ts';

function set(id: string, batch: string, description?: string): OverlaySet {
  return {
    id, batch, name: `Set ${id}`, description, asset: 'BTC', color: '#3d9bff', createdAt: 1,
    shapes: [{ type: 'hline', price: 100, color: '#3d9bff', style: 'solid' }],
  };
}

beforeEach(() => {
  useAiOverlayStore.setState({ sets: [], enabledIds: [], connected: false });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
});
afterEach(() => vi.unstubAllGlobals());

describe('AiOverlayPanel', () => {
  it('shows only a faint status line when not connected and empty', () => {
    render(<AiOverlayPanel />);
    expect(screen.getByTestId('ai-overlay-status')).toHaveTextContent(/not connected/);
    expect(screen.queryByText('AI overlays')).toBeNull();
  });

  it('renders nothing when connected with no sets', () => {
    useAiOverlayStore.setState({ connected: true });
    const { container } = render(<AiOverlayPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders chips grouped by batch, untoggled, with description tooltips', () => {
    act(() => useAiOverlayStore.getState().receive([
      set('a', 'b1', 'why A'), set('b', 'b1'), set('c', 'b2'),
    ]));
    render(<AiOverlayPanel />);
    expect(screen.getByText('AI overlays')).toBeInTheDocument();
    const a = screen.getByRole('button', { name: 'Set a' });
    expect(a).toHaveAttribute('title', 'why A');
    expect(a).not.toHaveClass('active');
    expect(a.style.borderLeft).toMatch(/2px solid/);
    // two batches -> one divider between groups
    const panel = screen.getByTestId('ai-overlay-panel');
    const groups = Array.from(panel.querySelectorAll('div')).filter(d => d.style.flexWrap === 'wrap');
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelectorAll('.btn-toggle')).toHaveLength(2);
  });

  it('toggles a chip on and off', () => {
    act(() => useAiOverlayStore.getState().receive([set('a', 'b1'), set('b', 'b1')]));
    render(<AiOverlayPanel />);
    const a = screen.getByRole('button', { name: 'Set a' });
    fireEvent.click(a);
    expect(a).toHaveClass('active');
    fireEvent.click(screen.getByRole('button', { name: 'Set b' }));
    expect(useAiOverlayStore.getState().enabledIds).toEqual(['a', 'b']);
    fireEvent.click(a);
    expect(a).not.toHaveClass('active');
    expect(useAiOverlayStore.getState().enabledIds).toEqual(['b']);
  });

  it('removes a set with × and clears all with clear', () => {
    act(() => useAiOverlayStore.getState().receive([set('a', 'b1'), set('b', 'b1')]));
    render(<AiOverlayPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Set a' }));
    expect(screen.queryByRole('button', { name: 'Set a' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(useAiOverlayStore.getState().sets).toEqual([]);
  });
});

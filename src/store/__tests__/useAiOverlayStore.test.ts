import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAiOverlayStore, onOverlayToggle } from '../useAiOverlayStore.ts';
import type { OverlaySet } from '../../services/ai/types.ts';

function set(id: string, batch = 'b1'): OverlaySet {
  return {
    id, batch, name: `Set ${id}`, asset: 'BTC', color: '#f0b90b', createdAt: 1,
    shapes: [{ type: 'hline', price: 100, color: '#f0b90b', style: 'solid' }],
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useAiOverlayStore.setState({ sets: [], enabledIds: [], connected: false });
  fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  onOverlayToggle(null);
});

describe('useAiOverlayStore', () => {
  it('receives sets with nothing enabled', () => {
    useAiOverlayStore.getState().receive([set('a'), set('b')]);
    const s = useAiOverlayStore.getState();
    expect(s.sets.map(x => x.id)).toEqual(['a', 'b']);
    expect(s.enabledIds).toEqual([]);
    expect(s.connected).toBe(true);
  });

  it('toggles on and off, several at once, and reports toggles', () => {
    const seen: Array<[string, boolean]> = [];
    onOverlayToggle((id, en) => seen.push([id, en]));
    useAiOverlayStore.getState().receive([set('a'), set('b')]);
    useAiOverlayStore.getState().toggle('a');
    useAiOverlayStore.getState().toggle('b');
    expect(useAiOverlayStore.getState().enabledIds).toEqual(['a', 'b']);
    useAiOverlayStore.getState().toggle('a');
    expect(useAiOverlayStore.getState().enabledIds).toEqual(['b']);
    expect(seen).toEqual([['a', true], ['b', true], ['a', false]]);
    useAiOverlayStore.getState().toggle('missing');
    expect(useAiOverlayStore.getState().enabledIds).toEqual(['b']);
  });

  it('keeps enabled state for ids that survive a receive', () => {
    useAiOverlayStore.getState().receive([set('a'), set('b')]);
    useAiOverlayStore.getState().toggle('a');
    useAiOverlayStore.getState().toggle('b');
    useAiOverlayStore.getState().receive([set('b'), set('c', 'b2')]);
    expect(useAiOverlayStore.getState().enabledIds).toEqual(['b']);
  });

  it('restores server toggles on a fresh page but not over local choices', () => {
    // Fresh page: server says a and b are on.
    useAiOverlayStore.getState().receive([set('a'), set('b')], ['a', 'b', 'gone']);
    expect(useAiOverlayStore.getState().enabledIds).toEqual(['a', 'b']);
    // User turns a off locally; a later broadcast still listing a as on must not re-enable it.
    useAiOverlayStore.getState().toggle('a');
    useAiOverlayStore.getState().receive([set('a'), set('b'), set('c', 'b2')], ['a', 'b', 'c']);
    expect(useAiOverlayStore.getState().enabledIds).toEqual(['b', 'c']);
  });

  it('remove deletes locally and on the server', () => {
    useAiOverlayStore.getState().receive([set('a'), set('b')]);
    useAiOverlayStore.getState().toggle('a');
    useAiOverlayStore.getState().remove('a');
    expect(useAiOverlayStore.getState().sets.map(x => x.id)).toEqual(['b']);
    expect(useAiOverlayStore.getState().enabledIds).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/overlays?id=a', { method: 'DELETE' });
  });

  it('clearAll empties and deletes everything on the server', () => {
    useAiOverlayStore.getState().receive([set('a')]);
    useAiOverlayStore.getState().clearAll();
    expect(useAiOverlayStore.getState().sets).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/overlays', { method: 'DELETE' });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSignalStore, resetSignalStoreForTest } from '../useSignalStore.ts';
import { signal } from '../../test/signalFixture.ts';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetSignalStoreForTest();
  fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useSignalStore', () => {
  it('marks signals that arrive after the first list as unseen, until clicked', () => {
    const st = () => useSignalStore.getState();
    st().receive([signal('a')]);
    expect(st().unseenIds).toEqual([]);
    st().receive([signal('b'), signal('a')]);
    expect(st().unseenIds).toEqual(['v3:b']);
    st().toggle('v3:b');
    expect(st().unseenIds).toEqual([]);
    expect(st().enabledIds).toEqual(['v3:b']);
    st().toggle('v3:b');
    expect(st().enabledIds).toEqual([]);
  });

  it('drops toggles for signals the server no longer lists', () => {
    const st = () => useSignalStore.getState();
    st().receive([signal('a'), signal('b')]);
    st().toggle('v3:a');
    st().receive([signal('b')]);
    expect(st().enabledIds).toEqual([]);
  });

  it('dismiss removes the signal and tells the server', () => {
    const st = () => useSignalStore.getState();
    st().receive([signal('a')]);
    st().dismiss('v3:a');
    expect(st().signals).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/api/signals?id=v3%3Aa', { method: 'DELETE' });
  });
});

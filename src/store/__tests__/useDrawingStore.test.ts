// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDrawingStore } from '../useDrawingStore.ts';

beforeEach(() => {
  localStorage.clear();
  useDrawingStore.setState({ lines: [], fibs: [] });
});

describe('useDrawingStore', () => {
  it('adds, moves, labels and removes a line, persisting each step', () => {
    const s = useDrawingStore.getState();
    const line = s.addLine('BTC', 109230);
    expect(useDrawingStore.getState().lines).toEqual([line]);
    expect(JSON.parse(localStorage.getItem('hl-drawings')!).lines).toHaveLength(1);

    s.moveLine(line.id, 109500);
    expect(useDrawingStore.getState().lines[0].price).toBe(109500);

    s.setLineText(line.id, '  PDH ');
    expect(useDrawingStore.getState().lines[0].text).toBe('PDH');
    s.setLineText(line.id, '');
    expect(useDrawingStore.getState().lines[0].text).toBeUndefined();

    s.removeLine(line.id);
    expect(useDrawingStore.getState().lines).toEqual([]);
    expect(JSON.parse(localStorage.getItem('hl-drawings')!).lines).toEqual([]);
  });

  it('clearAsset removes only that asset\'s lines and fibs', () => {
    const s = useDrawingStore.getState();
    s.addLine('BTC', 1);
    s.addLine('ETH', 2);
    s.addFib('BTC', { p1: 1, p2: 2, t1: 1000, t2: 2000 });
    s.addFib('ETH', { p1: 1, p2: 2, t1: 1000, t2: 2000 });
    s.clearAsset('BTC');
    const { lines, fibs } = useDrawingStore.getState();
    expect(lines.map(l => l.asset)).toEqual(['ETH']);
    expect(fibs.map(f => f.asset)).toEqual(['ETH']);
  });

  it('drops malformed saved entries on load', async () => {
    localStorage.setItem('hl-drawings', JSON.stringify({
      lines: [{ id: 'x' }, { id: 'y', asset: 'BTC', price: 5, createdAt: 0 }],
      fibs: 'nope',
    }));
    vi.resetModules();
    const fresh = await import('../useDrawingStore.ts');
    const { lines, fibs } = fresh.useDrawingStore.getState();
    expect(lines.map(l => l.id)).toEqual(['y']);
    expect(fibs).toEqual([]);
  });
});

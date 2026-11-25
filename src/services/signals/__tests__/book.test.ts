import { describe, it, expect } from 'vitest';
import { SignalBook, SignalValidationError, SIGNAL_MAX_AGE_MS, signalRr } from '../book.ts';
import { signalOverlaySet } from '../overlay.ts';

const NOW = Date.UTC(2026, 10, 25, 15, 0);
const sig = (over: Record<string, unknown> = {}) => ({
  key: 'k1', asset: 'xyz:SP500', tf: '15m', time: NOW - 60_000, entry: 7609, stop: 7649.8, target: 7523.6, ...over,
});

describe('SignalBook', () => {
  it('stores a signal, derives the side from the stop, and keeps receivedAt on update', () => {
    const book = new SignalBook();
    const r = book.push({ source: 'v3', signals: [sig()] }, NOW);
    expect(r.added).toEqual(['v3:k1']);
    const s = book.list()[0];
    expect(s).toMatchObject({ id: 'v3:k1', side: 'short', strategy: 'v3', status: 'resting', receivedAt: NOW });
    expect(signalRr(s)).toBeCloseTo(85.4 / 40.8, 5);

    expect(book.push({ source: 'v3', signals: [sig()] }, NOW + 1000)).toMatchObject({ added: [], updated: [] });
    const r2 = book.push({ source: 'v3', signals: [sig({ status: 'cancelled', statusNote: 'gap inverted', endTime: NOW })] }, NOW + 2000);
    expect(r2.updated).toEqual(['v3:k1']);
    expect(book.list()[0]).toMatchObject({ status: 'cancelled', receivedAt: NOW, updatedAt: NOW + 2000, endTime: NOW });
  });

  it('replace drops the source\'s other signals and leaves other sources alone', () => {
    const book = new SignalBook();
    book.push({ source: 'v3', signals: [sig(), sig({ key: 'k2' })] }, NOW);
    book.push({ source: 'other', signals: [sig()] }, NOW);
    const r = book.push({ source: 'v3', replace: true, signals: [sig({ key: 'k2' })] }, NOW);
    expect(r.removed).toEqual(['v3:k1']);
    expect(book.list().map(s => s.id).sort()).toEqual(['other:k1', 'v3:k2']);
  });

  it('a dismissed signal stays out while its source keeps sending it', () => {
    const book = new SignalBook();
    book.push({ source: 'v3', signals: [sig()] }, NOW);
    expect(book.dismiss('v3:k1')).toBe(true);
    expect(book.push({ source: 'v3', replace: true, signals: [sig()] }, NOW).added).toEqual([]);
    expect(book.list()).toEqual([]);
    book.push({ source: 'v3', replace: true, signals: [] }, NOW);
    expect(book.push({ source: 'v3', replace: true, signals: [sig()] }, NOW).added).toEqual(['v3:k1']);
  });

  it('rejects the whole push when a signal is wrong', () => {
    const book = new SignalBook();
    const bad = () => book.push({ source: 'v3', signals: [sig(), sig({ key: 'k2', side: 'long' })] }, NOW);
    expect(bad).toThrow(SignalValidationError);
    try { bad(); } catch (e) { expect((e as SignalValidationError).details[0]).toMatch(/\[k2\] a long needs stop < entry < target/); }
    expect(book.list()).toEqual([]);
    expect(() => book.push({ signals: [] }, NOW)).toThrow(/source is required/);
    expect(() => book.push({ source: 'v3', signals: [sig({ shapes: [{ type: 'circle' }] })] }, NOW)).toThrow(SignalValidationError);
  });

  it('records each source\'s last push, also an empty one', () => {
    const book = new SignalBook();
    book.push({ source: 'v3', replace: true, signals: [], lagSec: 6.24, watching: 'SP500, 5m' }, NOW);
    expect(book.listSources()).toEqual([{ source: 'v3', lastPushAt: NOW, lagSec: 6.2, watching: 'SP500, 5m' }]);
  });

  it('drops signals older than the age limit', () => {
    const book = new SignalBook();
    book.push({ source: 'v3', signals: [sig({ time: NOW - SIGNAL_MAX_AGE_MS - 1 })] }, NOW);
    expect(book.list()).toEqual([]);
  });

  it('keeps shape times as given, with no chart to snap to', () => {
    const book = new SignalBook();
    const t = NOW - 37 * 60_000;
    book.push({ source: 'v3', signals: [sig({ shapes: [{ type: 'arrow', time: t, price: 7649.8, dir: 'down', text: 'Sweep' }] })] }, NOW);
    expect(book.list()[0].shapes).toEqual([{ type: 'arrow', time: t, price: 7649.8, dir: 'down', text: 'Sweep', color: '#f0b90b' }]);
  });
});

describe('signalOverlaySet', () => {
  it('draws the context shapes plus a setup box that runs to the right edge while the plan is live', () => {
    const book = new SignalBook();
    book.push({ source: 'v3', signals: [sig({ shapes: [{ type: 'hline', price: 7640, text: 'MSS' }] })] }, NOW);
    const set = signalOverlaySet(book.list()[0], NOW);
    expect(set.asset).toBe('xyz:SP500');
    expect(set.shapes[0]).toMatchObject({ type: 'hline', price: 7640, text: 'MSS' });
    const boxes = set.shapes.filter(s => s.type === 'box');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ p1: 7609, p2: 7523.6, t2Now: true });
    expect(boxes[1]).toMatchObject({ p1: 7649.8, p2: 7609, t2Now: true });
    expect(set.shapes.at(-3)).toMatchObject({ type: 'hline', price: 7523.6, text: 'Target 7523.6  2.1R' });
  });

  it('ends the box at endTime once the plan is over', () => {
    const book = new SignalBook();
    book.push({ source: 'v3', signals: [sig({ status: 'cancelled', endTime: NOW - 10_000 })] }, NOW);
    const box = signalOverlaySet(book.list()[0], NOW).shapes.find(s => s.type === 'box');
    expect(box).toMatchObject({ t2: NOW - 10_000 });
    expect(box).not.toHaveProperty('t2Now');
  });
});

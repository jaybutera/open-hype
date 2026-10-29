import { describe, it, expect } from 'vitest';
import { normalizeOverlaySet, normalizePush, parseTime, OverlayValidationError } from '../validate.ts';
import type { ChartSnapshot, SnapshotCandle } from '../types.ts';
import { formatEt } from '../../../utils/chartTime.ts';

// 2026-03-02 14:30 UTC = 09:30 ET (EST, UTC-5)
const T0 = Date.UTC(2026, 2, 2, 14, 30);
const BAR = 300_000;

function candles(n: number): SnapshotCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const t = T0 + i * BAR;
    const base = 100 + i;
    return { t, et: formatEt(t), o: base, h: base + 2, l: base - 2, c: base + 1, v: 10 };
  });
}

function snap(over: Partial<ChartSnapshot> = {}): ChartSnapshot {
  const c = candles(20);
  return {
    takenAt: T0 + 20 * BAR,
    mode: 'paper', replay: false, pane: 'primary', asset: 'BTC', interval: '5m',
    timezone: 'America/New_York',
    visible: { from: c[0].t, to: c[c.length - 1].t, bars: c.length },
    candles: c, mid: 120, position: null, orders: [], setups: [], pendingSetup: null,
    trading: { status: 'none', account: null, network: 'mainnet' },
    fibs: [], lines: [], overlays: [], ...over,
  };
}

describe('formatEt', () => {
  it('formats UTC ms as New York wall time', () => {
    expect(formatEt(T0)).toBe('2026-03-02 09:30 ET');
    expect(formatEt(Date.UTC(2026, 6, 1, 13, 30))).toBe('2026-07-01 09:30 ET');
  });
});

describe('parseTime', () => {
  it('accepts ms, seconds, ISO strings and ET strings', () => {
    expect(parseTime(T0)).toBe(T0);
    expect(parseTime(T0 / 1000)).toBe(T0);
    expect(parseTime('2026-03-02T14:30:00Z')).toBe(T0);
    expect(parseTime('2026-03-02T09:30:00-05:00')).toBe(T0);
    expect(parseTime('2026-03-02 09:30 ET')).toBe(T0);
    expect(() => parseTime('yesterday')).toThrow(/cannot read time/);
  });
});

describe('normalizeOverlaySet', () => {
  it('accepts time strings and ms and resolves both to bar opens', () => {
    const { set, warnings } = normalizeOverlaySet({
      name: 'OB + sweep',
      shapes: [
        { type: 'arrow', time: T0 + 2 * BAR, price: 102, dir: 'up' },
        { type: 'arrow', time: '2026-03-02T14:40:00Z', price: 102, dir: 'down' },
        { type: 'vline', time: '2026-03-02 09:40 ET' },
      ],
    }, snap(), { id: 'x', batch: 'b' });
    expect(warnings).toEqual([]);
    expect(set.shapes.map(s => (s as { time: number }).time)).toEqual([T0 + 2 * BAR, T0 + 2 * BAR, T0 + 2 * BAR]);
    expect(set.asset).toBe('BTC');
    expect(set.id).toBe('x');
    expect(set.batch).toBe('b');
  });

  it('snaps a time inside a bar to that bar open', () => {
    const { set } = normalizeOverlaySet({
      name: 'snap', shapes: [{ type: 'vline', time: T0 + 3 * BAR + 170_000 }],
    }, snap());
    expect((set.shapes[0] as { time: number }).time).toBe(T0 + 3 * BAR);
  });

  it('snaps across a gap to the nearest bar and warns when moved more than half a bar', () => {
    const c = candles(10).filter((_, i) => i < 4 || i > 7); // gap 4..7
    const s = snap({ candles: c });
    const { set, warnings } = normalizeOverlaySet({
      name: 'gap', shapes: [{ type: 'vline', time: T0 + 5 * BAR }],
    }, s);
    expect((set.shapes[0] as { time: number }).time).toBe(T0 + 3 * BAR);
    expect(warnings.join('\n')).toMatch(/no bar; moved to the nearest bar/);
  });

  it('warns when an arrow price is outside its bar but keeps it', () => {
    const { set, warnings } = normalizeOverlaySet({
      name: 'off', shapes: [{ type: 'arrow', time: T0, price: 150, dir: 'down' }],
    }, snap());
    expect((set.shapes[0] as { price: number }).price).toBe(150);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/outside the 2026-03-02 09:30 ET bar \(high 102, low 98\)/);
  });

  it('rejects an unknown shape type naming the allowed types', () => {
    expect(() => normalizeOverlaySet({ name: 'bad', shapes: [{ type: 'circle', time: T0 }] }, snap()))
      .toThrow(/unknown; allowed types: hline, box, line, arrow, label, vline/);
  });

  it('rejects a bad colour and accepts palette names', () => {
    expect(() => normalizeOverlaySet({ name: 'c', shapes: [{ type: 'hline', price: 100, color: 'chartreuse' }] }, snap()))
      .toThrow(OverlayValidationError);
    expect(() => normalizeOverlaySet({ name: 'c', color: '#12345', shapes: [{ type: 'hline', price: 100 }] }, snap()))
      .toThrow(/invalid color/);
    const { set } = normalizeOverlaySet({ name: 'c', shapes: [{ type: 'hline', price: 100, color: 'red' }] }, snap());
    expect(set.shapes[0].color).toBe('#f6465d');
  });

  it('extends t2: "now" to the last bar and orders box prices', () => {
    const { set } = normalizeOverlaySet({
      name: 'zone', shapes: [{ type: 'box', t1: T0, t2: 'now', p1: 99, p2: 105 }],
    }, snap());
    const box = set.shapes[0];
    expect(box).toMatchObject({ type: 'box', t1: T0, t2: T0 + 19 * BAR, t2Now: true, p1: 105, p2: 99 });
  });

  it('gives every shape a colour from the set default', () => {
    const { set } = normalizeOverlaySet({
      name: 'p', shapes: [{ type: 'label', time: T0, price: 100, text: 'here' }],
    }, snap(), { index: 1 });
    expect(set.color).toMatch(/^#/);
    expect(set.shapes[0].color).toBe(set.color);
  });

  it('enforces name and shape limits', () => {
    expect(() => normalizeOverlaySet({ name: '', shapes: [{ type: 'hline', price: 1 }] }, snap())).toThrow(/name is required/);
    expect(() => normalizeOverlaySet({ name: 'x'.repeat(41), shapes: [{ type: 'hline', price: 1 }] }, snap())).toThrow(/max 40/);
    const many = Array.from({ length: 41 }, () => ({ type: 'hline', price: 100 }));
    expect(() => normalizeOverlaySet({ name: 'many', shapes: many }, snap())).toThrow(/max 40 per set/);
    expect(() => normalizeOverlaySet({ name: 'neg', shapes: [{ type: 'hline', price: -1 }] }, snap())).toThrow(/> 0/);
  });

  it('warns on a different asset', () => {
    const { set, warnings } = normalizeOverlaySet({ name: 'eth', asset: 'ETH', shapes: [{ type: 'hline', price: 3000 }] }, snap());
    expect(set.asset).toBe('ETH');
    expect(warnings.join()).toMatch(/differs from the chart's BTC/);
  });

  it('checks bars against the pane that shows the set asset, never another asset', () => {
    // Active pane is SP500 near 7700; the other pane shows XYZ100 near 29300.
    const sp = candles(20).map(c => ({ ...c, o: c.o + 7600, h: c.h + 7600, l: c.l + 7600, c: c.c + 7600 }));
    const nq = candles(20).map(c => ({ ...c, o: c.o + 29200, h: c.h + 29200, l: c.l + 29200, c: c.c + 29200 }));
    const s = snap({
      pane: 'secondary', asset: 'xyz:SP500', candles: sp,
      panes: [
        { pane: 'primary', asset: 'xyz:XYZ100', interval: '5m', candles: nq },
        { pane: 'secondary', asset: 'xyz:SP500', interval: '5m', candles: sp },
      ],
    });
    const arrow = { type: 'arrow', time: T0 + 5 * BAR, price: sp[5].l, dir: 'up' };
    // Default asset is the active pane's, and the SP500 price fits its SP500 bar.
    const a = normalizeOverlaySet({ name: 'a', shapes: [arrow] }, s);
    expect(a.set.asset).toBe('xyz:SP500');
    expect(a.warnings).toEqual([]);
    // A set for the other pane's asset is checked against that pane's bars.
    const b = normalizeOverlaySet({ name: 'b', asset: 'xyz:XYZ100', shapes: [{ ...arrow, price: sp[5].l }] }, s);
    expect(b.warnings.join()).toMatch(/outside the .* bar \(high 29307/);
    const b2 = normalizeOverlaySet({ name: 'b2', asset: 'xyz:XYZ100', shapes: [{ ...arrow, price: nq[5].l }] }, s);
    expect(b2.warnings).toEqual([]);
    // No pane shows ETH: no bar check against SP500 or XYZ100 bars.
    const c = normalizeOverlaySet({ name: 'c', asset: 'ETH', shapes: [{ ...arrow, price: 3000 }] }, s);
    expect(c.warnings.join()).not.toMatch(/outside the/);
    expect(c.warnings.join()).toMatch(/not checked/);
  });

  it('keeps times as given when there are no candles', () => {
    const { set, warnings } = normalizeOverlaySet({ name: 'empty', shapes: [{ type: 'vline', time: T0 + 1234 }] }, snap({ candles: [] }));
    expect((set.shapes[0] as { time: number }).time).toBe(T0 + 1234);
    expect(warnings.join()).toMatch(/kept as given/);
  });
});

describe('normalizePush', () => {
  it('shares one batch across sets and caps the set count', () => {
    const r = normalizePush({ sets: [
      { name: 'A', shapes: [{ type: 'hline', price: 100 }] },
      { name: 'B', shapes: [{ type: 'hline', price: 101 }] },
    ] }, snap());
    expect(r.sets).toHaveLength(2);
    expect(r.sets[0].batch).toBe(r.sets[1].batch);
    expect(r.sets[0].color).not.toBe(r.sets[1].color);
    const tooMany = Array.from({ length: 13 }, (_, i) => ({ name: `s${i}`, shapes: [{ type: 'hline', price: 1 }] }));
    expect(() => normalizePush({ sets: tooMany }, snap())).toThrow(/max 12 per push/);
  });

  it('reports every bad set in details', () => {
    try {
      normalizePush({ sets: [
        { name: 'A', shapes: [{ type: 'nope' }] },
        { name: 'B', shapes: [{ type: 'hline', price: 'x' }] },
      ] }, snap());
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(OverlayValidationError);
      const d = (e as OverlayValidationError).details;
      expect(d).toHaveLength(2);
      expect(d[0]).toMatch(/^\[A\]/);
      expect(d[1]).toMatch(/^\[B\]/);
    }
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertEngine } from '../../../../alert-engine.ts';
import { SimClock } from '../../../../sim-clock.ts';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'hl-sim-')), 'alerts.json');
const MIN = 60_000;
const T0 = Date.UTC(2026, 6, 7, 13, 30); // 09:30 ET
const bar = (t: number, o: number, h: number, l: number, c: number) =>
  ({ t, o: String(o), h: String(h), l: String(l), c: String(c) });

describe('AlertEngine manual feed', () => {
  it('never opens a socket and stamps alerts with the sim clock', () => {
    const WS = vi.fn();
    let now = T0;
    const e = new AlertEngine(tmpFile(), () => {}, { feed: 'manual', now: () => now, WebSocket: WS as unknown as typeof WebSocket });
    const { alert } = e.add({ asset: 'xyz:SP500', level: 7700, direction: 'above' }, { defaultAsset: null, mid: 7690 });
    expect(WS).not.toHaveBeenCalled();
    expect(alert.createdAt).toBe(T0);
    now = T0 + 5 * MIN;
    e.ingestBar('xyz:SP500', bar(T0 + 4 * MIN, 7695, 7702, 7694, 7698));
    expect(e.list()[0].status).toBe('fired');
    expect(e.list()[0].firedAt).toBe(T0 + 5 * MIN);
    expect(e.list()[0].firedPrice).toBe(7702);
  });

  it('fires a cross on a wick, not only on the close', () => {
    const e = new AlertEngine(tmpFile(), () => {}, { feed: 'manual', now: () => T0 });
    e.add({ asset: 'xyz:SP500', level: 7680, direction: 'below' }, { defaultAsset: null, mid: 7690 });
    e.ingestBar('xyz:SP500', bar(T0, 7690, 7691, 7678, 7689));
    expect(e.list()[0].status).toBe('fired');
  });

  it('fires a close alert when the next interval bucket starts', () => {
    const e = new AlertEngine(tmpFile(), () => {}, { feed: 'manual', now: () => T0 });
    e.add({ asset: 'xyz:SP500', kind: 'close', interval: '5m', level: 7700, direction: 'above' }, { defaultAsset: null, mid: 7690 });
    for (let i = 0; i < 5; i++) e.ingestBar('xyz:SP500', bar(T0 + i * MIN, 7695, 7710, 7690, i === 4 ? 7705 : 7699));
    expect(e.list()[0].status).toBe('armed'); // 09:30 bar has not closed yet
    e.ingestBar('xyz:SP500', bar(T0 + 5 * MIN, 7705, 7706, 7704, 7705));
    expect(e.list()[0].status).toBe('fired');
    expect(e.list()[0].firedPrice).toBe(7705);
    expect(e.list()[0].firedBarT).toBe(T0);
  });

  it('freshMid returns the last replayed price instead of calling the API', async () => {
    const fetchFn = vi.fn();
    const e = new AlertEngine(tmpFile(), () => {}, { feed: 'manual', now: () => T0, fetch: fetchFn as unknown as typeof fetch });
    expect(await e.freshMid('xyz:SP500')).toBeNull();
    e.ingestBar('xyz:SP500', bar(T0, 1, 3, 0.5, 2));
    expect(await e.freshMid('xyz:SP500')).toBe(2);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('SimClock', () => {
  afterEach(() => { vi.useRealTimers(); });
  const clock = () => {
    const c = new SimClock(null);
    c.begin({ asset: 'xyz:SP500', interval: '5m', start: T0, end: T0 + 60 * MIN });
    c.started(T0);
    return c;
  };

  it('goes idle on Stop and busy again when a wait resolves', () => {
    const c = clock();
    const onIdle = vi.fn();
    c.onIdle(onIdle);
    c.idle();
    expect(c.state).toBe('idle');
    expect(onIdle).toHaveBeenCalledOnce();
    c.wake('al_1', 'alert');
    expect(c.state).toBe('busy');
    c.wake('al_1', 'alert'); // the same event reported twice wakes once
    c.idle();
    expect(c.state).toBe('idle');
  });

  it('absorbs the Stop after a wait resolved mid-turn, then idles if the agent never returns', () => {
    vi.useFakeTimers();
    const c = clock();
    c.wake('t_1', 'trade'); // resolved while the agent was still working
    c.idle();
    expect(c.state).toBe('busy');
    vi.advanceTimersByTime(31_000);
    expect(c.state).toBe('idle');
  });

  it('keeps the clock stopped when the woken agent shows activity, until its next Stop', () => {
    vi.useFakeTimers();
    const c = clock();
    c.wake('t_1', 'trade');
    c.idle();
    c.activity();
    vi.advanceTimersByTime(60_000);
    expect(c.state).toBe('busy');
    c.idle();
    expect(c.state).toBe('idle');
  });

  it('stops the clock on activity while idle', () => {
    const c = clock();
    c.idle();
    c.activity();
    expect(c.state).toBe('busy');
  });
});

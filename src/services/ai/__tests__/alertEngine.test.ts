import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertEngine, dexOf, subscriptionFor, midsKey, candleKey } from '../../../../alert-engine.ts';

class FakeWs {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeWs[] = [];
  readyState = FakeWs.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(public url: string) { FakeWs.all.push(this); }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = FakeWs.CLOSED; this.onclose?.({ code: 1006 }); }
  open() { this.readyState = FakeWs.OPEN; this.onopen?.(); }
  push(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  subs() { return this.sent.filter(m => m.method === 'subscribe').map(m => m.subscription); }
}

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'hl-alerts-')), 'alerts.json');
const noFetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
const engine = (file = tmpFile(), fetchImpl: typeof fetch = noFetch) =>
  new AlertEngine(file, () => {}, { WebSocket: FakeWs as unknown as typeof WebSocket, fetch: fetchImpl });

afterEach(() => { FakeWs.all = []; vi.useRealTimers(); });

describe('subscription keys', () => {
  it('splits HIP-3 coins into a dex and keeps the full coin for candles', () => {
    expect(dexOf('BTC')).toBe('');
    expect(dexOf('xyz:SP500')).toBe('xyz');
    expect(subscriptionFor(midsKey(''))).toEqual({ type: 'allMids' });
    expect(subscriptionFor(midsKey('xyz'))).toEqual({ type: 'allMids', dex: 'xyz' });
    expect(subscriptionFor(candleKey('xyz:SP500', '15m'))).toEqual({ type: 'candle', coin: 'xyz:SP500', interval: '15m' });
  });
});

describe('AlertEngine', () => {
  it('fires a cross alert on a HIP-3 asset from the dex allMids feed', () => {
    const e = engine();
    e.add({ asset: 'xyz:SP500', level: 7699, direction: 'above' }, { defaultAsset: null, mid: 7681 });
    e.add({ asset: 'BTC', level: 81218, direction: 'above' }, { defaultAsset: null, mid: 81212 });
    const ws = FakeWs.all[0];
    ws.open();
    expect(ws.subs()).toEqual(expect.arrayContaining([{ type: 'allMids', dex: 'xyz' }, { type: 'allMids' }]));
    // The main-dex feed never carries xyz coins.
    ws.push({ channel: 'allMids', data: { mids: { BTC: '81200' } } });
    expect(e.list().every(a => a.status === 'armed')).toBe(true);
    ws.push({ channel: 'allMids', data: { dex: 'xyz', mids: { 'xyz:SP500': '7699.9' } } });
    const sp = e.list().find(a => a.asset === 'xyz:SP500')!;
    expect(sp).toMatchObject({ status: 'fired', firedPrice: 7699.9 });
    ws.push({ channel: 'allMids', data: { mids: { BTC: '81223.5' } } });
    expect(e.list().find(a => a.asset === 'BTC')).toMatchObject({ status: 'fired', firedPrice: 81223.5 });
    e.close();
  });

  it('subscribes HIP-3 candles with the full coin and fires a close alert', () => {
    const e = engine();
    e.add({ asset: 'xyz:SP500', kind: 'close', interval: '15m', level: 7670, direction: 'below' }, { defaultAsset: null, mid: 7695 });
    const ws = FakeWs.all[0];
    ws.open();
    expect(ws.subs()).toEqual([{ type: 'candle', coin: 'xyz:SP500', interval: '15m' }]);
    ws.push({ channel: 'candle', data: { t: 1, s: 'xyz:SP500', i: '15m', c: '7668.9' } });
    ws.push({ channel: 'candle', data: { t: 2, s: 'xyz:SP500', i: '15m', c: '7672' } });
    expect(e.list()[0]).toMatchObject({ status: 'fired', firedPrice: 7668.9, firedBarT: 1 });
    e.close();
  });

  it('connects at boot for alerts loaded from disk and reconnects after a drop', () => {
    vi.useFakeTimers();
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ alerts: [{
      id: 'al_old', asset: 'xyz:SP500', kind: 'cross', direction: 'above', level: 7687,
      source: 'mcp', createdAt: 1, refPrice: null, status: 'armed',
    }] }));
    const e = engine(file);
    expect(FakeWs.all).toHaveLength(1);
    FakeWs.all[0].open();
    FakeWs.all[0].close();
    vi.advanceTimersByTime(1000);
    expect(FakeWs.all).toHaveLength(2);
    const ws = FakeWs.all[1];
    ws.open();
    expect(ws.subs()).toEqual([{ type: 'allMids', dex: 'xyz' }]);
    ws.push({ channel: 'allMids', data: { dex: 'xyz', mids: { 'xyz:SP500': '7705.8' } } });
    expect(e.list()[0].status).toBe('fired');
    e.close();
  });

  it('reopens a socket that goes silent', () => {
    vi.useFakeTimers();
    const e = engine();
    e.add({ asset: 'BTC', level: 90000, direction: 'above' }, { defaultAsset: null, mid: 81000 });
    FakeWs.all[0].open();
    vi.advanceTimersByTime(90_000);
    vi.advanceTimersByTime(1000);
    expect(FakeWs.all.length).toBeGreaterThanOrEqual(2);
    e.close();
  });

  it('fetches a fresh mid for the dex, and returns null when the fetch fails', async () => {
    const calls: unknown[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ 'xyz:SP500': '7699.05' }) };
    }) as unknown as typeof fetch;
    const e = engine(tmpFile(), fetchImpl);
    expect(await e.freshMid('xyz:SP500')).toBe(7699.05);
    expect(calls).toEqual([{ type: 'allMids', dex: 'xyz' }]);
    expect(await engine().freshMid('BTC')).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  TradeDesk, TradeValidationError, normalizeTradeAction, describeAction, EXECUTING_TIMEOUT_MS,
} from '../trades.ts';

const ctx = { defaultAsset: 'BTC', mode: 'paper' as const };

function desk(start = 1_000_000) {
  let now = start;
  let n = 0;
  const d = new TradeDesk({ now: () => now, newId: () => `t${++n}` });
  return { d, advance: (ms: number) => { now += ms; } };
}

describe('normalizeTradeAction', () => {
  it('fills the coin from the chart and accepts long/short', () => {
    expect(normalizeTradeAction({ kind: 'order', side: 'long', price: 59000, size: 0.01, sl: 58000 }, 'BTC')).toEqual({
      kind: 'order', coin: 'BTC', side: 'buy', orderType: 'limit', price: 59000, size: 0.01, sl: 58000,
    });
    expect(normalizeTradeAction({ kind: 'close', coin: 'ETH' }, 'BTC')).toEqual({ kind: 'close', coin: 'ETH' });
  });

  it.each([
    [{ kind: 'order', side: 'buy', orderType: 'limit', size: 1 }, /needs price/],
    [{ kind: 'order', side: 'buy', orderType: 'market', price: 1, size: 1 }, /takes no price/],
    [{ kind: 'order', side: 'buy', price: 1 }, /exactly one of size/],
    [{ kind: 'order', side: 'buy', price: 1, size: 1, sizeUsd: 5 }, /exactly one of size/],
    [{ kind: 'order', side: 'buy', price: 1, riskUsd: 5 }, /riskUsd sizing needs sl/],
    [{ kind: 'order', side: 'buy', price: 1, size: 1, reduceOnly: true, sl: 0.5 }, /reduce-only order takes no tp\/sl/],
    [{ kind: 'order', side: 'up', price: 1, size: 1 }, /side must be/],
    [{ kind: 'order', side: 'buy', price: -1, size: 1 }, /price must be a positive number/],
    [{ kind: 'order', side: 'buy', price: 1, size: 1, leverage: 2.5 }, /leverage/],
    [{ kind: 'tpsl', tpsl: 'stop', price: 1 }, /tpsl must be/],
    [{ kind: 'cancel' }, /give oids/],
    [{ kind: 'cancel', oids: [5, '5'] }, /duplicates/],
    [{ kind: 'swap' }, /kind must be/],
  ])('rejects %j', (raw, msg) => {
    expect(() => normalizeTradeAction(raw, 'BTC')).toThrow(msg);
  });

  it('needs a coin when no chart is connected', () => {
    expect(() => normalizeTradeAction({ kind: 'close' }, null)).toThrow(TradeValidationError);
  });

  it('keeps numeric oids numeric and paper ids as strings; all: true cancels everything', () => {
    expect(normalizeTradeAction({ kind: 'cancel', oids: ['42', 'paper-ord-3'] }, 'BTC')).toEqual({ kind: 'cancel', coin: 'BTC', oids: [42, 'paper-ord-3'] });
    expect(normalizeTradeAction({ kind: 'cancel', all: true }, 'BTC')).toEqual({ kind: 'cancel', coin: 'BTC', oids: 'all' });
  });

  it('describes actions in one line', () => {
    expect(describeAction({ kind: 'order', coin: 'BTC', side: 'sell', orderType: 'limit', price: 61000, riskUsd: 50, sl: 61500, replaceOid: 9 }))
      .toBe('Sell BTC risking $50 limit @ 61000 (SL 61500), replacing #9');
    expect(describeAction({ kind: 'tpsl', coin: 'ETH', tpsl: 'sl', price: 2400 })).toBe('SL on ETH position at 2400');
    expect(describeAction({ kind: 'cancel', coin: 'BTC', oids: 'all' })).toBe('Cancel all BTC orders');
  });
});

describe('TradeDesk', () => {
  it('stores a pending proposal with the page mode and default expiry', () => {
    const { d } = desk();
    const t = d.propose({ action: { kind: 'close' }, note: '  sweep done  ' }, ctx);
    expect(t).toMatchObject({ id: 't1', status: 'pending', mode: 'paper', note: 'sweep done', action: { kind: 'close', coin: 'BTC' } });
    expect(t.expiresAt - t.createdAt).toBe(900_000);
  });

  it('needs a mode when no page has reported one', () => {
    const { d } = desk();
    expect(() => d.propose({ action: { kind: 'close' } }, { defaultAsset: 'BTC', mode: null })).toThrow(/mode/);
    expect(d.propose({ action: { kind: 'close' }, mode: 'live' }, { defaultAsset: 'BTC', mode: null }).mode).toBe('live');
  });

  it('only the first claim wins, and the result settles it', async () => {
    const { d } = desk();
    const t = d.propose({ action: { kind: 'close' } }, ctx);
    const waiting = d.wait(t.id, 5000);
    expect(d.claim(t.id, 'user').ok).toBe(true);
    expect(d.claim(t.id, 'auto')).toEqual({ ok: false, error: 'proposal is executing' });
    expect(d.reject(t.id)).toBeNull();
    expect(d.withdraw(t.id)).toBeNull();
    d.finish(t.id, { ok: true, message: 'filled 0.01 @ 60000' });
    const done = await waiting;
    expect(done).toMatchObject({ status: 'done', decidedBy: 'user', result: { ok: true, message: 'filled 0.01 @ 60000' } });
    expect(d.finish(t.id, { ok: false, message: 'again' })).toBeNull();
  });

  it('a failed exchange answer marks it failed', () => {
    const { d } = desk();
    const t = d.propose({ action: { kind: 'close' } }, ctx);
    d.claim(t.id);
    expect(d.finish(t.id, { ok: false, message: 'rejected: margin' })?.status).toBe('failed');
  });

  it('reject and withdraw only touch pending proposals', () => {
    const { d } = desk();
    const a = d.propose({ action: { kind: 'close' } }, ctx);
    const b = d.propose({ action: { kind: 'close' } }, ctx);
    expect(d.reject(a.id, 'not now')?.result).toEqual({ ok: false, message: 'not now' });
    expect(d.withdraw(b.id)?.status).toBe('withdrawn');
    expect(d.claim(a.id).ok).toBe(false);
  });

  it('expires pending proposals and fails claims whose page went away', async () => {
    const { d, advance } = desk();
    const a = d.propose({ action: { kind: 'close' }, expiresInSec: 30 }, ctx);
    const b = d.propose({ action: { kind: 'close' } }, ctx);
    d.claim(b.id);
    const changed = vi.fn();
    d.onChange(changed);
    advance(30_000);
    d.sweep();
    expect(d.get(a.id)?.status).toBe('expired');
    expect(d.get(b.id)?.status).toBe('executing');
    advance(EXECUTING_TIMEOUT_MS);
    d.sweep();
    expect(d.get(b.id)?.status).toBe('failed');
    expect(changed).toHaveBeenCalledTimes(2);
    expect(await d.wait(a.id, 10)).toMatchObject({ status: 'expired' });
  });

  it('wait times out with null and reports unknown ids as undefined', async () => {
    const { d } = desk();
    const t = d.propose({ action: { kind: 'close' } }, ctx);
    expect(await d.wait(t.id, 5)).toBeNull();
    expect(await d.wait('nope', 5)).toBeUndefined();
  });

  it('keeps the last 20 finished proposals and every open one', () => {
    const { d } = desk();
    const open = d.propose({ action: { kind: 'close' } }, ctx);
    for (let i = 0; i < 25; i++) d.reject(d.propose({ action: { kind: 'close' } }, ctx).id);
    const list = d.list();
    expect(list.filter(t => t.status === 'rejected')).toHaveLength(20);
    expect(list.some(t => t.id === open.id)).toBe(true);
  });

  it('rejects bad expiry', () => {
    const { d } = desk();
    expect(() => d.propose({ action: { kind: 'close' }, expiresInSec: 5 }, ctx)).toThrow(/expiresInSec/);
  });
});

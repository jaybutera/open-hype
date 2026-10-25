import { describe, it, expect, beforeEach } from 'vitest';
import { fitLeverage, fitLiveLeverage } from '../leverageFit.ts';
import { useLiveAccountStore, type LivePosition } from '../../../store/useLiveAccountStore.ts';

const btcLong = (over: Partial<LivePosition> = {}): LivePosition => ({
  coin: 'BTC', szi: 0.1, entryPx: 80000, positionValue: 8000, unrealizedPnl: 0, returnOnEquity: 0,
  liquidationPx: null, marginUsed: 800, leverage: { type: 'cross', value: 10 }, ...over,
});

describe('fitLeverage', () => {
  it('keeps leverage when margin fits, never lowers it', () => {
    expect(fitLeverage({ coin: 'BTC', notional: 1000, available: 1000, leverage: 25, cap: 40 })).toEqual({ ok: true, leverage: 25, bumped: false });
  });
  it('raises to the ceiling of notional over available', () => {
    expect(fitLeverage({ coin: 'BTC', notional: 32853, available: 1682.42, leverage: 10, cap: 40, buffer: 1.02 }))
      .toEqual({ ok: true, leverage: 20, bumped: true });
  });
  it('errors past the cap', () => {
    const r = fitLeverage({ coin: 'ETH', notional: 50000, available: 1000, leverage: 10, cap: 25 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/needs 50x but ETH caps at 25x .* Widen the stop or lower risk\./);
  });
  it('leaves leverage alone with no known margin', () => {
    expect(fitLeverage({ coin: 'BTC', notional: 1e6, available: 0, leverage: 3, cap: 40 })).toEqual({ ok: true, leverage: 3, bumped: false });
  });
});

describe('fitLiveLeverage', () => {
  beforeEach(() => useLiveAccountStore.getState().reset());

  it('adding to a same-side position counts the whole position against free margin plus its margin', () => {
    useLiveAccountStore.setState({ withdrawable: 200, positions: [btcLong()] });
    // 8000 + 8000 = 16000 * 1.02 over 200 + 800 = 1000 -> 17x.
    const r = fitLiveLeverage({ coin: 'BTC', side: 'buy', size: 0.1, price: 80000, leverage: 10, cap: 40 });
    expect(r).toMatchObject({ ok: true, leverage: 17, bumped: true, notional: 16000, available: 1000 });
  });

  it('an opposite-side order only needs margin for what is left after the flip', () => {
    useLiveAccountStore.setState({ withdrawable: 200, positions: [btcLong()] });
    const r = fitLiveLeverage({ coin: 'BTC', side: 'sell', size: 0.15, price: 80000, leverage: 10, cap: 40 });
    expect(r).toMatchObject({ ok: true, leverage: 10, bumped: false, notional: 4000 });
  });
});

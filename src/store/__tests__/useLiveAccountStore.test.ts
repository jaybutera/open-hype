import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLiveAccountStore, mergeFills, type LiveFill } from '../useLiveAccountStore.ts';
import { clearSpotPriceCache } from '../../services/hl/balances.ts';
import { stubHyperliquidFetch } from '../../test/hlMocks.ts';

const USER = '0x338DAe824E0d0B3f5565597BBe2d02B4140B186A';

const idlePerp = {
  marginSummary: { accountValue: '0.0', totalNtlPos: '0.0', totalRawUsd: '0.0', totalMarginUsed: '0.0' },
  withdrawable: '0.0', assetPositions: [],
};
// Shape of a unified account with no open position: all USDC sits in spot.
const unifiedSpot = {
  balances: [
    { coin: 'USDC', token: 0, total: '260.896634', hold: '0.0', entryNtl: '0.0' },
    { coin: 'USDE', token: 235, total: '0.0', hold: '0.0', entryNtl: '0.0' },
  ],
  tokenToAvailableAfterMaintenance: [[0, '260.896634']],
};

const rawFill = (tid: number, time: number, extra: object = {}) => ({
  coin: 'BTC', px: '84086.0', sz: '0.02145', side: 'A', time, startPosition: '0.02145', dir: 'Close Long',
  closedPnl: '11.86185', hash: '0x1', oid: 571706361029, crossed: true, fee: '0.779174', tid, feeToken: 'USDC', twapId: null,
  ...extra,
});

beforeEach(() => {
  useLiveAccountStore.getState().reset();
  clearSpotPriceCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('account value', () => {
  it('counts spot USDC, so a unified account with no position is not $0', async () => {
    stubHyperliquidFetch({
      info: b => (b.type === 'clearinghouseState' ? idlePerp
        : b.type === 'spotClearinghouseState' ? unifiedSpot
        : b.type === 'userFills' ? [] : undefined),
    });
    await useLiveAccountStore.getState().refresh(USER);
    const s = useLiveAccountStore.getState();
    expect(s.syncError).toBeNull();
    expect(s.accountValue).toBeCloseTo(260.896634, 6);
    expect(s.perpValue).toBe(0);
    expect(s.spotValue).toBeCloseTo(260.896634, 6);
    expect(s.withdrawable).toBeCloseTo(260.896634, 6);
    expect(s.spotBalances).toEqual([{ coin: 'USDC', token: 0, total: 260.896634, hold: 0, usdValue: 260.896634 }]);
  });

  it('adds perp equity on every dex to spot while a position is open', async () => {
    stubHyperliquidFetch({
      info: b => (b.type === 'clearinghouseState'
        ? { marginSummary: { accountValue: b.dex ? '50' : '236.783282', totalMarginUsed: b.dex ? '10' : '234' }, withdrawable: '0', assetPositions: [] }
        : b.type === 'spotClearinghouseState' ? { balances: [{ coin: 'USDC', token: 0, total: '12.342786', hold: '0' }] }
        : b.type === 'userFills' ? [] : undefined),
    });
    await useLiveAccountStore.getState().refresh(USER);
    const s = useLiveAccountStore.getState();
    expect(s.accountValue).toBeCloseTo(236.783282 + 50 + 12.342786, 6);
    expect(s.marginUsed).toBe(244);
    expect(s.perps.map(p => p.dex)).toEqual(['', 'xyz']);
  });

  it('prices non-USDC spot tokens from their USDC pair mid', async () => {
    const net = stubHyperliquidFetch({
      info: b => (b.type === 'clearinghouseState' ? idlePerp
        : b.type === 'spotClearinghouseState' ? { balances: [
          { coin: 'USDC', token: 0, total: '100', hold: '0' },
          { coin: 'HYPE', token: 150, total: '2', hold: '0' },
        ] }
        : b.type === 'spotMetaAndAssetCtxs' ? [
          { universe: [{ tokens: [1, 0], index: 0 }, { tokens: [150, 0], index: 1 }] },
          [{ markPx: '0.12', midPx: '0.12' }, { markPx: '40.1', midPx: '40.0' }],
        ]
        : b.type === 'userFills' ? [] : undefined),
    });
    await useLiveAccountStore.getState().refresh(USER);
    expect(useLiveAccountStore.getState().spotValue).toBeCloseTo(180, 6);
    // Prices are cached, not refetched every poll.
    await useLiveAccountStore.getState().refresh(USER);
    expect(net.calls.filter(c => c.body?.type === 'spotMetaAndAssetCtxs')).toHaveLength(1);
  });
});

describe('trade history', () => {
  it('loads recent fills once, then polls only fills since the newest one', async () => {
    const net = stubHyperliquidFetch({
      info: b => (b.type === 'userFills' ? [rawFill(2, 2000), rawFill(1, 1000, { dir: 'Open Long', side: 'B', closedPnl: '0.0' })]
        : b.type === 'userFillsByTime' ? [rawFill(2, 2000), rawFill(3, 3000)]
        : undefined),
    });
    await useLiveAccountStore.getState().refresh(USER);
    let s = useLiveAccountStore.getState();
    expect(s.fillsLoaded).toBe(true);
    expect(s.fills.map(f => f.tid)).toEqual([2, 1]);
    expect(s.fills[1]).toMatchObject({ side: 'buy', dir: 'Open Long', closedPnl: 0 });

    await useLiveAccountStore.getState().refresh(USER);
    s = useLiveAccountStore.getState();
    expect(s.fills.map(f => f.tid)).toEqual([3, 2, 1]);
    const fillReqs = net.calls.filter(c => String(c.body?.type).startsWith('userFills')).map(c => c.body);
    expect(fillReqs).toEqual([
      { type: 'userFills', user: USER, aggregateByTime: true },
      { type: 'userFillsByTime', user: USER, startTime: 2000, aggregateByTime: true },
    ]);
  });

  it('a failed history fetch keeps balances syncing', async () => {
    stubHyperliquidFetch({
      info: b => (b.type === 'spotClearinghouseState' ? unifiedSpot : b.type === 'userFills' ? 'oops' : undefined),
    });
    await useLiveAccountStore.getState().refresh(USER);
    const s = useLiveAccountStore.getState();
    expect(s.syncError).toBeNull();
    expect(s.accountValue).toBeCloseTo(260.896634, 6);
    expect(s.fillsLoaded).toBe(false);
  });

  it('switching accounts drops the previous account\'s fills', async () => {
    stubHyperliquidFetch({ info: b => (b.type === 'userFills' ? (b.user === USER ? [rawFill(1, 1000)] : []) : undefined) });
    await useLiveAccountStore.getState().refresh(USER);
    expect(useLiveAccountStore.getState().fills).toHaveLength(1);
    await useLiveAccountStore.getState().refresh('0x0000000000000000000000000000000000000001');
    expect(useLiveAccountStore.getState().fills).toHaveLength(0);
  });

  it('mergeFills dedupes by trade id and keeps newest first', () => {
    const f = (tid: number, time: number) => ({ tid, time }) as LiveFill;
    const known = [f(2, 200), f(1, 100)];
    expect(mergeFills(known, [])).toBe(known);
    expect(mergeFills(known, [f(2, 200)])).toBe(known);
    expect(mergeFills(known, [f(3, 200), f(4, 300)]).map(x => x.tid)).toEqual([4, 3, 2, 1]);
  });
});

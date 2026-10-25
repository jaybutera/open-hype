import { create } from 'zustand';
import { postInfo } from '../services/api/client.ts';
import type { Side } from '../types/order.ts';
import {
  loadAbstraction, loadSpotPrices, needsSpotPrices, spotBalanceUsd, spotCarriesPerpEquity, spotUsdcAvailable,
  type RawSpotState,
} from '../services/hl/balances.ts';

export interface LivePosition {
  coin: string;
  szi: number;
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  marginUsed: number;
  leverage: { type: 'cross' | 'isolated'; value: number };
}

export interface LiveOpenOrder {
  coin: string;
  oid: number;
  side: Side;
  limitPx: string;
  sz: string;
  origSz: string;
  orderType: string;
  isTrigger: boolean;
  triggerPx: string;
  triggerCondition: string;
  reduceOnly: boolean;
  isPositionTpsl: boolean;
  timestamp: number;
}

export interface LiveFill {
  coin: string;
  px: number;
  sz: number;
  side: Side;
  time: number;
  /** Hyperliquid's direction label, e.g. "Open Long", "Close Short". */
  dir: string;
  closedPnl: number;
  fee: number;
  feeToken: string;
  oid: number;
  tid: number;
}

export interface LiveSpotBalance { coin: string; token: number; total: number; hold: number; usdValue: number }
export interface LivePerpSummary { dex: string; accountValue: number; marginUsed: number; withdrawable: number }

interface RawFill {
  coin: string; px: string; sz: string; side: 'A' | 'B'; time: number; dir: string;
  closedPnl: string; fee: string; feeToken: string; oid: number; tid: number;
}

interface RawPosition {
  coin: string; szi: string; entryPx: string; positionValue: string; unrealizedPnl: string;
  returnOnEquity: string; liquidationPx: string | null; marginUsed: string;
  leverage: { type: 'cross' | 'isolated'; value: number };
}
interface RawClearinghouse {
  marginSummary: { accountValue: string; totalMarginUsed: string };
  withdrawable: string;
  assetPositions: { position: RawPosition }[];
}
interface RawOpenOrder {
  coin: string; side: 'A' | 'B'; limitPx: string; sz: string; oid: number; timestamp: number;
  triggerCondition: string; isTrigger: boolean; triggerPx: string; reduceOnly: boolean;
  orderType: string; origSz: string; isPositionTpsl: boolean;
}

/** Builder-deployed dexes whose assets the app trades; each has its own clearinghouse. */
export const LIVE_DEXES = ['', 'xyz'] as const;

/** Most fills kept in memory; matches what a single `userFills` request returns. */
const MAX_FILLS = 2000;

interface LiveAccountStore {
  user: string | null;
  /**
   * Equity in USD. Standard accounts: perps across all dexes plus spot. Unified and portfolio-margin
   * accounts: spot alone, since their spot USDC is the collateral perp accountValue also reports.
   */
  accountValue: number;
  perpValue: number;
  spotValue: number;
  /** Spot balances include perp equity, so perpValue and spotValue overlap rather than add up. */
  unified: boolean;
  /** Free USDC: perp withdrawable plus free spot USDC, or spot available after maintenance when unified. */
  withdrawable: number;
  marginUsed: number;
  perps: LivePerpSummary[];
  spotBalances: LiveSpotBalance[];
  positions: LivePosition[];
  openOrders: LiveOpenOrder[];
  /** Trade history, newest first, partial fills of one crossing order merged. */
  fills: LiveFill[];
  fillsLoaded: boolean;
  lastSync: number | null;
  syncError: string | null;
  refresh: (user: string) => Promise<void>;
  reset: () => void;
}

const empty = {
  user: null, accountValue: 0, perpValue: 0, spotValue: 0, unified: false, withdrawable: 0, marginUsed: 0,
  perps: [], spotBalances: [], positions: [], openOrders: [], fills: [], fillsLoaded: false,
  lastSync: null, syncError: null,
};

function toPosition(p: RawPosition): LivePosition {
  return {
    coin: p.coin,
    szi: parseFloat(p.szi),
    entryPx: parseFloat(p.entryPx),
    positionValue: parseFloat(p.positionValue),
    unrealizedPnl: parseFloat(p.unrealizedPnl),
    returnOnEquity: parseFloat(p.returnOnEquity),
    liquidationPx: p.liquidationPx == null ? null : parseFloat(p.liquidationPx),
    marginUsed: parseFloat(p.marginUsed),
    leverage: p.leverage,
  };
}

function toOrder(o: RawOpenOrder): LiveOpenOrder {
  return {
    coin: o.coin, oid: o.oid, side: o.side === 'B' ? 'buy' : 'sell',
    limitPx: o.limitPx, sz: o.sz, origSz: o.origSz, orderType: o.orderType,
    isTrigger: o.isTrigger, triggerPx: o.triggerPx, triggerCondition: o.triggerCondition,
    reduceOnly: o.reduceOnly, isPositionTpsl: o.isPositionTpsl, timestamp: o.timestamp,
  };
}

function toFill(f: RawFill): LiveFill {
  return {
    coin: f.coin, px: parseFloat(f.px), sz: parseFloat(f.sz), side: f.side === 'B' ? 'buy' : 'sell',
    time: f.time, dir: f.dir, closedPnl: parseFloat(f.closedPnl), fee: parseFloat(f.fee),
    feeToken: f.feeToken, oid: f.oid, tid: f.tid,
  };
}

/** Merge fresh fills into the known list by trade id, newest first. */
export function mergeFills(known: LiveFill[], fresh: LiveFill[]): LiveFill[] {
  if (fresh.length === 0) return known;
  const seen = new Set(known.map(f => f.tid));
  const added = fresh.filter(f => !seen.has(f.tid));
  if (added.length === 0) return known;
  return [...added, ...known].sort((a, b) => b.time - a.time || b.tid - a.tid).slice(0, MAX_FILLS);
}

export const useLiveAccountStore = create<LiveAccountStore>((set, get) => ({
  ...empty,
  refresh: async (user) => {
    if (get().user !== user) set({ ...empty, user });
    try {
      const withDex = (dex: string) => (dex ? { dex } : {});
      const { fills: knownFills, fillsLoaded } = get();
      // First load pulls the latest fills; later polls only ask for what happened since the newest one.
      const fillsReq = fillsLoaded
        ? { type: 'userFillsByTime', user, startTime: knownFills[0]?.time ?? 0, aggregateByTime: true }
        : { type: 'userFills', user, aggregateByTime: true };
      const [states, orders, spot, rawFills, abstraction] = await Promise.all([
        Promise.all(LIVE_DEXES.map(dex =>
          postInfo<RawClearinghouse>({ type: 'clearinghouseState', user, ...withDex(dex) }).catch(e => (dex ? null : Promise.reject(e))))),
        Promise.all(LIVE_DEXES.map(dex =>
          postInfo<RawOpenOrder[]>({ type: 'frontendOpenOrders', user, ...withDex(dex) }).catch(e => (dex ? [] : Promise.reject(e))))),
        postInfo<RawSpotState>({ type: 'spotClearinghouseState', user }),
        // History is secondary: a failed fetch keeps the old list instead of failing the sync.
        postInfo<RawFill[]>(fillsReq).catch(() => null),
        loadAbstraction(user),
      ]);
      const balances = Array.isArray(spot?.balances) ? spot.balances : [];
      const prices = needsSpotPrices(balances) ? await loadSpotPrices().catch(() => undefined) : undefined;
      // Ignore a response that lands after the user switched accounts.
      if (get().user !== user) return;
      const perps: LivePerpSummary[] = [];
      states.forEach((s, i) => {
        if (!s?.marginSummary) return;
        perps.push({
          dex: LIVE_DEXES[i],
          accountValue: parseFloat(s.marginSummary.accountValue),
          marginUsed: parseFloat(s.marginSummary.totalMarginUsed),
          withdrawable: parseFloat(s.withdrawable ?? '0'),
        });
      });
      const valid = states.filter((s): s is RawClearinghouse => !!s && !!s.marginSummary);
      const spotBalances = balances
        .filter(b => parseFloat(b.total) !== 0)
        .map(b => ({
          coin: b.coin, token: b.token, total: parseFloat(b.total), hold: parseFloat(b.hold),
          usdValue: spotBalanceUsd(b, prices),
        }));
      const perpValue = perps.reduce((a, p) => a + p.accountValue, 0);
      const spotValue = spotBalances.reduce((a, b) => a + b.usdValue, 0);
      const unified = spotCarriesPerpEquity(abstraction, spot);
      const spotFree = spot ? spotUsdcAvailable({ ...spot, balances }) : 0;
      set({
        user,
        accountValue: unified ? spotValue : perpValue + spotValue,
        perpValue,
        spotValue,
        unified,
        marginUsed: perps.reduce((a, p) => a + p.marginUsed, 0),
        withdrawable: unified ? spotFree : (perps[0]?.withdrawable ?? 0) + spotFree,
        perps,
        spotBalances,
        positions: valid.flatMap(s => s.assetPositions.map(ap => toPosition(ap.position))).filter(p => p.szi !== 0),
        openOrders: orders.flat().map(toOrder).sort((a, b) => b.timestamp - a.timestamp),
        ...(Array.isArray(rawFills)
          ? { fills: mergeFills(fillsLoaded ? get().fills : [], rawFills.map(toFill)), fillsLoaded: true }
          : {}),
        lastSync: Date.now(),
        syncError: null,
      });
    } catch (e) {
      if (get().user !== user) return;
      set({ syncError: e instanceof Error ? e.message : String(e) });
    }
  },
  reset: () => set({ ...empty }),
}));

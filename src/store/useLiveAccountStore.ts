import { create } from 'zustand';
import { postInfo } from '../services/api/client.ts';
import type { Side } from '../types/order.ts';

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

interface LiveAccountStore {
  user: string | null;
  accountValue: number;
  withdrawable: number;
  marginUsed: number;
  positions: LivePosition[];
  openOrders: LiveOpenOrder[];
  lastSync: number | null;
  syncError: string | null;
  refresh: (user: string) => Promise<void>;
  reset: () => void;
}

const empty = {
  user: null, accountValue: 0, withdrawable: 0, marginUsed: 0,
  positions: [], openOrders: [], lastSync: null, syncError: null,
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

export const useLiveAccountStore = create<LiveAccountStore>((set, get) => ({
  ...empty,
  refresh: async (user) => {
    if (get().user !== user) set({ ...empty, user });
    try {
      const withDex = (dex: string) => (dex ? { dex } : {});
      const [states, orders] = await Promise.all([
        Promise.all(LIVE_DEXES.map(dex =>
          postInfo<RawClearinghouse>({ type: 'clearinghouseState', user, ...withDex(dex) }).catch(e => (dex ? null : Promise.reject(e))))),
        Promise.all(LIVE_DEXES.map(dex =>
          postInfo<RawOpenOrder[]>({ type: 'frontendOpenOrders', user, ...withDex(dex) }).catch(e => (dex ? [] : Promise.reject(e))))),
      ]);
      // Ignore a response that lands after the user switched accounts.
      if (get().user !== user) return;
      const valid = states.filter((s): s is RawClearinghouse => !!s && !!s.marginSummary);
      set({
        user,
        accountValue: valid.reduce((a, s) => a + parseFloat(s.marginSummary.accountValue), 0),
        marginUsed: valid.reduce((a, s) => a + parseFloat(s.marginSummary.totalMarginUsed), 0),
        withdrawable: parseFloat(valid[0]?.withdrawable ?? '0'),
        positions: valid.flatMap(s => s.assetPositions.map(ap => toPosition(ap.position))).filter(p => p.szi !== 0),
        openOrders: orders.flat().map(toOrder).sort((a, b) => b.timestamp - a.timestamp),
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

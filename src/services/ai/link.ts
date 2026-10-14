/**
 * Page side of the AI chart link. Talks to vite-ai-plugin.ts over the Vite HMR
 * websocket: answers snapshot requests and receives pushed overlay sets.
 * Dev server only; in a production build `import.meta.hot` is undefined and
 * startAiLink() does nothing.
 */
import { useMarketStore, type PaneId } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useLiveAccountStore } from '../../store/useLiveAccountStore.ts';
import { useTradeSetupStore } from '../../store/useTradeSetupStore.ts';
import { useReplayStore } from '../../store/useReplayStore.ts';
import { useAiOverlayStore, onOverlayToggle } from '../../store/useAiOverlayStore.ts';
import { useAlertStore } from '../../store/useAlertStore.ts';
import { useAiTradeStore } from '../../store/useAiTradeStore.ts';
import { useWalletStore, selectActiveAccount } from '../../store/useWalletStore.ts';
import { NETWORK } from '../hl/network.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import type { TradeProposal } from './trades.ts';
import type { Alert } from './alerts.ts';
import type { ChartSnapshot, OverlaySet, SnapshotCandle, SnapshotFib, SnapshotOrder, SnapshotPosition } from './types.ts';

/** What the active chart pane contributes to a snapshot. */
export interface PaneView {
  pane: PaneId;
  asset: string;
  interval: string;
  visible: { from: number; to: number; bars: number };
  candles: SnapshotCandle[];
  fibs: SnapshotFib[];
}

export type SnapshotProvider = () => PaneView | null;

let provider: SnapshotProvider | null = null;

/** The active TradingChart pane registers here. Returns an unregister function. */
export function registerSnapshotProvider(fn: SnapshotProvider): () => void {
  provider = fn;
  return () => { if (provider === fn) provider = null; };
}

let paperEngine: PaperEngine | null = null;

/** The paper engine the app is running, for executing confirmed paper proposals. */
export function getPaperEngine(): PaperEngine | null {
  return paperEngine;
}

/** Live TP/SL kind from Hyperliquid's order type label ("Take Profit Market", "Stop Market"...). */
export function liveTpsl(orderType: string): 'tp' | 'sl' | undefined {
  if (/take profit/i.test(orderType)) return 'tp';
  if (/stop/i.test(orderType)) return 'sl';
  return undefined;
}

function positionFor(asset: string, mode: 'paper' | 'live'): SnapshotPosition | null {
  if (mode === 'live') {
    const p = useLiveAccountStore.getState().positions.find(x => x.coin === asset && x.szi !== 0);
    if (!p) return null;
    return {
      side: p.szi > 0 ? 'long' : 'short', size: Math.abs(p.szi), entry: p.entryPx,
      upnl: p.unrealizedPnl, liq: p.liquidationPx,
    };
  }
  const p = useAccountStore.getState().paperPositions.find(x => x.coin === asset && !x.szi.isZero());
  if (!p) return null;
  let liq: number | null = null;
  try { liq = paperEngine?.getLiquidationPrice(asset)?.toNumber() ?? null; } catch { liq = null; }
  return {
    side: p.szi.gt(0) ? 'long' : 'short', size: p.szi.abs().toNumber(), entry: p.entryPx.toNumber(),
    upnl: p.unrealizedPnl.toNumber(), liq,
  };
}

function ordersFor(asset: string, mode: 'paper' | 'live'): SnapshotOrder[] {
  if (mode === 'live') {
    return useLiveAccountStore.getState().openOrders
      .filter(o => o.coin === asset)
      .map(o => {
        const tpsl = o.isTrigger ? liveTpsl(o.orderType) : undefined;
        return {
          oid: o.oid,
          side: o.side,
          type: o.orderType,
          price: parseFloat(o.isTrigger ? o.triggerPx : o.limitPx),
          size: parseFloat(o.sz),
          reduceOnly: o.reduceOnly,
          ...(tpsl ? { tpsl } : {}),
        };
      });
  }
  return useAccountStore.getState().paperOrders
    .filter(o => o.coin === asset)
    .map(o => ({
      oid: o.id,
      side: o.side,
      type: o.type === 'trigger' ? `trigger${o.tpsl ? ` ${o.tpsl}` : ''}` : 'limit',
      price: (o.type === 'trigger' && o.triggerPx ? o.triggerPx : o.price).toNumber(),
      size: o.size.toNumber(),
      reduceOnly: o.reduceOnly,
      ...(o.type === 'trigger' && o.tpsl ? { tpsl: o.tpsl } : {}),
    }));
}

/** Build a snapshot from the registered pane plus what the stores know. */
export function buildSnapshot(): ChartSnapshot {
  const market = useMarketStore.getState();
  const mode = useSettingsStore.getState().mode;
  const view = provider?.() ?? null;
  const paneId = view?.pane ?? market.activePaneId;
  const pane = market.panes[paneId] ?? market.panes.primary;
  const asset = view?.asset ?? pane?.asset ?? 'BTC';
  const interval = view?.interval ?? pane?.interval ?? '5m';
  const midStr = market.allMids[asset];
  const mid = midStr !== undefined && Number.isFinite(parseFloat(midStr)) ? parseFloat(midStr) : null;
  const { activeSetups, pendingSetup } = useTradeSetupStore.getState();
  const { sets, enabledIds } = useAiOverlayStore.getState();

  return {
    takenAt: Date.now(),
    mode,
    replay: useReplayStore.getState().active,
    pane: paneId,
    asset,
    interval,
    timezone: 'America/New_York',
    visible: view?.visible ?? { from: 0, to: 0, bars: 0 },
    candles: view?.candles ?? [],
    mid,
    position: positionFor(asset, mode),
    orders: ordersFor(asset, mode),
    trading: (() => {
      const w = useWalletStore.getState();
      return { status: w.tradingStatus, account: selectActiveAccount(w), network: NETWORK };
    })(),
    setups: activeSetups.map(s => ({
      id: s.id,
      side: s.side === 'buy' ? 'long' as const : 'short' as const,
      asset: s.asset,
      entry: s.entryPrice,
      sl: s.slPrice,
      tp: s.tpPrice,
      size: s.assetSize,
      riskUsdc: s.riskUsdc,
      rr: s.rr,
    })),
    pendingSetup: pendingSetup
      ? { side: pendingSetup.side === 'buy' ? 'long' : 'short', clicks: [...pendingSetup.clicks] }
      : null,
    fibs: view?.fibs ?? [],
    overlays: sets.map(s => ({ id: s.id, name: s.name, enabled: enabledIds.includes(s.id) })),
  };
}

let started = false;

export function startAiLink(engine?: PaperEngine): void {
  if (engine) paperEngine = engine;
  const hot = import.meta.hot;
  if (!hot || started) return;
  started = true;

  const sendSnapshot = (reqId?: string) => {
    try {
      hot.send('hl-ai:snapshot', { snapshot: buildSnapshot(), reqId });
    } catch (e) {
      console.warn('[ai] snapshot failed', e);
    }
  };

  hot.on('hl-ai:snapshot-request', (data: { reqId?: string } | undefined) => sendSnapshot(data?.reqId));
  hot.on('hl-ai:overlays', (data: { sets?: OverlaySet[]; enabled?: string[] } | undefined) => {
    useAiOverlayStore.getState().receive(
      Array.isArray(data?.sets) ? data!.sets : [],
      Array.isArray(data?.enabled) ? data!.enabled : undefined,
    );
  });
  hot.on('hl-ai:alerts', (data: { alerts?: Alert[] } | undefined) => {
    useAlertStore.getState().receive(Array.isArray(data?.alerts) ? data!.alerts : []);
  });
  hot.on('hl-ai:trades', (data: { trades?: TradeProposal[] } | undefined) => {
    useAiTradeStore.getState().receive(Array.isArray(data?.trades) ? data!.trades : []);
  });
  hot.on('vite:ws:disconnect', () => useAiOverlayStore.getState().setConnected(false));
  hot.on('vite:ws:connect', () => {
    useAiOverlayStore.getState().setConnected(true);
    hot.send('hl-ai:hello', {});
  });
  onOverlayToggle((id, enabled) => hot.send('hl-ai:toggle', { id, enabled }));

  useAiOverlayStore.getState().setConnected(true);
  // Ask for the current overlay list (survives page reloads) and seed the cache.
  hot.send('hl-ai:hello', {});
  sendSnapshot();
}

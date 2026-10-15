import { useRef, useEffect, useCallback, useState } from 'react';
import { useSettingsStore } from '../store/useSettingsStore.ts';
import { useAccountStore } from '../store/useAccountStore.ts';
import { usePaperAccountsStore } from '../store/usePaperAccountsStore.ts';
import { useFeeStore } from '../store/useFeeStore.ts';
import { useWalletStore } from '../store/useWalletStore.ts';
import { useMarketStore } from '../store/useMarketStore.ts';
import { PaperEngine } from '../engine/paper/PaperEngine.ts';
import type { DexFee } from '../engine/paper/pnl.ts';
import { appNow } from '../services/replay/clock.ts';

/** HIP-3 fee settings from the loaded xyz dex meta. */
function dexFeeOf(coin: string): DexFee | undefined {
  if (!coin.includes(':')) return undefined;
  const u = useMarketStore.getState().xyzMeta?.universe.find(a => a.name === coin);
  if (!u?.deployerFeeScale) return undefined;
  return { deployerFeeScale: Number(u.deployerFeeScale), growthMode: u.growthMode === 'enabled' };
}

function createEngineForAccount(
  acct: ReturnType<typeof usePaperAccountsStore.getState>['accounts'][0],
  leverage: number,
  makerRate: string,
  takerRate: string,
  onUpdate: (state: ReturnType<PaperEngine['getState']>) => void,
  onRejection: (reason: string) => void,
): PaperEngine {
  const engine = new PaperEngine({
    initialBalance: acct.initialBalance,
    leverage,
    makerRate,
    takerRate,
    dexFee: dexFeeOf,
    onUpdate,
    onRejection,
    now: appNow,
  });
  if (acct.fills.length > 0 || acct.positions.length > 0 || acct.openOrders.length > 0 || acct.balance !== acct.initialBalance) {
    engine.loadState(acct);
  }
  return engine;
}

export function usePaperEngine(): PaperEngine {
  const leverage = useSettingsStore(s => s.leverage);
  const updatePaperState = useAccountStore(s => s.updatePaperState);
  const saveActiveAccountState = usePaperAccountsStore(s => s.saveActiveAccountState);
  const activeAccountId = usePaperAccountsStore(s => s.activeAccountId);
  const getActiveAccount = usePaperAccountsStore(s => s.getActiveAccount);
  const makerRate = useFeeStore(s => s.makerRate);
  const takerRate = useFeeStore(s => s.takerRate);
  const fetchFees = useFeeStore(s => s.fetchFees);
  const resetFees = useFeeStore(s => s.resetToDefaults);
  const walletAddress = useWalletStore(s => s.address);

  const setRejection = useAccountStore(s => s.setRejection);

  const onUpdate = useCallback((state: Parameters<typeof updatePaperState>[0]) => {
    updatePaperState(state);
    saveActiveAccountState(state);
  }, [updatePaperState, saveActiveAccountState]);

  const onRejection = useCallback((reason: string) => {
    setRejection(reason);
  }, [setRejection]);

  const [engine, setEngine] = useState<PaperEngine>(() =>
    createEngineForAccount(getActiveAccount(), leverage, makerRate, takerRate, onUpdate, onRejection)
  );

  const prevAccountRef = useRef(activeAccountId);

  // Fetch user fees when wallet connects, reset when disconnected
  useEffect(() => {
    if (walletAddress) {
      fetchFees(walletAddress);
    } else {
      resetFees();
    }
  }, [walletAddress, fetchFees, resetFees]);

  // Update engine fee rates when they change
  useEffect(() => {
    engine.setFeeRates(makerRate, takerRate);
  }, [engine, makerRate, takerRate]);

  useEffect(() => {
    if (prevAccountRef.current !== activeAccountId) {
      prevAccountRef.current = activeAccountId;
      const newEngine = createEngineForAccount(getActiveAccount(), leverage, makerRate, takerRate, onUpdate, onRejection);
      setEngine(newEngine);
      updatePaperState(newEngine.getState());
    }
  }, [activeAccountId, getActiveAccount, leverage, makerRate, takerRate, onUpdate, updatePaperState]);

  useEffect(() => {
    engine.setLeverage(leverage);
  }, [engine, leverage]);

  return engine;
}

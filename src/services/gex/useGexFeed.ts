import { useEffect } from 'react';
import { useGexStore } from '../../store/useGexStore.ts';

const POLL_MS = 60_000;

/**
 * Keeps the GEX reading for a chart asset current while a GEX layer is on.
 * Returns the GEXBot ticker the asset maps to, or null.
 */
export function useGexFeed(asset: string): string | null {
  const tickers = useGexStore(s => s.tickers);
  const dte = useGexStore(s => s.dte);
  const wanted = useGexStore(s => s.levels || s.strikes !== 'off');
  const ticker = useGexStore(s => s.tickerFor(asset));
  const trailWanted = useGexStore(s => s.levels && s.trail);

  useEffect(() => {
    if (tickers === null) void useGexStore.getState().loadTickers();
  }, [tickers]);

  useEffect(() => {
    if (!wanted || !ticker) return;
    const tick = () => void useGexStore.getState().refresh(ticker);
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [wanted, ticker, dte]);

  useEffect(() => {
    if (!trailWanted || !ticker) return;
    // After the reading refresh, so the history request knows which session it is in.
    const tick = () => void useGexStore.getState().refresh(ticker).then(() => useGexStore.getState().refreshHistory(ticker));
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [trailWanted, ticker, dte]);

  return ticker;
}

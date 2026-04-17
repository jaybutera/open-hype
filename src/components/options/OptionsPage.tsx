import { useEffect, useMemo, useState } from 'react';
import { isMarketOpen, nextOpen } from '../../services/options/marketHours.ts';
import { YahooOptionsAdapter } from '../../services/options/yahooAdapter.ts';
import type { OptionChain } from '../../services/options/types.ts';
import { SymbolSearch } from './SymbolSearch.tsx';
import { ExpirationTabs } from './ExpirationTabs.tsx';
import { ChainGrid } from './ChainGrid.tsx';

const adapter = new YahooOptionsAdapter();

export function OptionsPage() {
  const [now, setNow] = useState(() => new Date());
  const [symbol, setSymbol] = useState<string | null>(null);
  const [chain, setChain] = useState<OptionChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExp, setSelectedExp] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Fetch chain when symbol or selectedExp changes. Symbol change clears exp and
  // loads the nearest expiration (the one Yahoo returns by default). Subsequent
  // exp changes refetch with ?date=.
  useEffect(() => {
    if (!symbol) {
      setChain(null);
      setSelectedExp(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    adapter
      .getChain(symbol, selectedExp ?? undefined)
      .then((c) => {
        if (cancelled) return;
        setChain(c);
        // On symbol change (selectedExp === null), pin selection to what Yahoo returned.
        if (selectedExp === null) setSelectedExp(c.loadedExpiration);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setChain(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, selectedExp]);

  // Reset chain + exp when the user switches symbol.
  const handleSymbolChange = (s: string) => {
    setSymbol(s);
    setChain(null);
    setSelectedExp(null);
  };

  const open = isMarketOpen(now);
  const reopen = open ? null : nextOpen(now);

  const expirations = useMemo(() => chain?.expirations ?? [], [chain]);

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e1e4e8' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        borderBottom: '1px solid #1a1f2e',
      }}>
        <a
          href="#/"
          style={{
            color: '#3861fb', textDecoration: 'none', fontWeight: 600, fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          &larr; Back to Trading
        </a>
        <span style={{ fontWeight: 800, fontSize: 16, color: '#3861fb' }}>
          Options (Paper)
        </span>
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: '3px 8px',
            borderRadius: 0,
            color: open ? '#0ecb81' : '#f6465d',
            background: open ? 'rgba(14,203,129,0.10)' : 'rgba(246,70,93,0.10)',
            border: `1px solid ${open ? '#0ecb81' : '#f6465d'}`,
            letterSpacing: 0.5,
          }}
        >
          {open ? 'MARKET OPEN' : 'MARKET CLOSED'}
        </span>
        {!open && reopen && (
          <span style={{ fontSize: 12, color: '#8a8f98' }}>
            Next open: {reopen.toLocaleString('en-US', {
              timeZone: 'America/New_York',
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })} ET
          </span>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid #1a1f2e',
      }}>
        <SymbolSearch value={symbol} onChange={handleSymbolChange} />
        {symbol && (
          <span style={{ fontSize: 13, color: '#8a8f98' }}>
            Loaded: <strong style={{ color: '#e1e4e8' }}>{symbol}</strong>
            {chain && (
              <>
                {' '}· <span style={{ color: '#e1e4e8' }}>${chain.underlyingPrice.toFixed(2)}</span>
              </>
            )}
          </span>
        )}
        {loading && (
          <span style={{ fontSize: 12, color: '#8a8f98' }}>Loading…</span>
        )}
        {error && (
          <span style={{ fontSize: 12, color: '#f6465d' }}>Error: {error}</span>
        )}
      </div>

      {expirations.length > 0 && (
        <ExpirationTabs
          expirations={expirations}
          selected={selectedExp}
          onSelect={setSelectedExp}
          now={now}
        />
      )}

      {!chain && (
        <div style={{ padding: 24, color: '#8a8f98', fontSize: 13 }}>
          {!symbol && 'Select a symbol above to load its option chain.'}
          {symbol && loading && `Loading chain for ${symbol}…`}
          {symbol && error && `Could not load ${symbol}: ${error}`}
        </div>
      )}
      {chain && <ChainGrid chain={chain} />}
    </div>
  );
}

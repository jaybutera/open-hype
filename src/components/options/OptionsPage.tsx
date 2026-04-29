import { useCallback, useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { isMarketOpen, nextOpen } from '../../services/options/marketHours.ts';
import { YahooOptionsAdapter } from '../../services/options/yahooAdapter.ts';
import { ChainFetchError } from '../../services/options/chainErrors.ts';
import type { Leg, LegSide, OptionChain, OptionContract } from '../../services/options/types.ts';
import { toggleLeg } from '../../services/options/legs.ts';
import type { PaperEngine } from '../../engine/paper/PaperEngine.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { SymbolSearch } from './SymbolSearch.tsx';
import { ExpirationTabs } from './ExpirationTabs.tsx';
import { ChainGrid } from './ChainGrid.tsx';
import { OrderForm } from './OrderForm.tsx';
import { PositionsOptions } from './PositionsOptions.tsx';
import { useOptionPositionQuotes } from './useOptionPositionQuotes.ts';

const adapter = new YahooOptionsAdapter();

const SPINNER_KEYFRAMES = `@keyframes hl-spin { to { transform: rotate(360deg); } }`;

function Spinner() {
  return (
    <>
      <style>{SPINNER_KEYFRAMES}</style>
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          borderRadius: '50%',
          border: '2px solid rgba(138,143,152,0.35)',
          borderTopColor: '#3861fb',
          animation: 'hl-spin 0.7s linear infinite',
        }}
      />
    </>
  );
}

interface Props {
  engine: PaperEngine;
}

type SubmitFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

type ChainError = { kind: string; message: string };

export function OptionsPage({ engine }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [symbol, setSymbol] = useState<string | null>(null);
  const [chain, setChain] = useState<OptionChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChainError | null>(null);
  const [selectedExp, setSelectedExp] = useState<number | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [feedback, setFeedback] = useState<SubmitFeedback | null>(null);
  const paperBalance = useAccountStore((s) => s.paperBalance);
  const optionPositions = useAccountStore((s) => s.paperOptionPositions);
  const optionPositionCount = optionPositions.length;

  const handleCellClick = useCallback((contract: OptionContract, side: LegSide) => {
    setLegs((prev) => toggleLeg(prev, contract, side));
    setFeedback(null);
  }, []);

  const handleSubmit = useCallback(
    (order: { orderType: 'limit' | 'market'; limitPrice: number | null; qtyScalar: number }) => {
      if (legs.length === 0) return;
      const result = engine.openOptionLegs(legs, { qtyScalar: order.qtyScalar, fillModel: 'mid' });
      if (result.success) {
        setLegs([]);
        setFeedback({
          kind: 'success',
          message: `Opened ${result.positions.length}-leg spread (${result.spreadId}).`,
        });
      } else {
        setFeedback({ kind: 'error', message: result.error });
      }
    },
    [engine, legs],
  );

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const open = isMarketOpen(now);
  const reopen = open ? null : nextOpen(now);

  // Fetch quotes for every (underlying, expiration) tuple referenced by open
  // positions, independently of the user's symbol-browsing state. Powers the
  // PositionsOptions panel's live PnL across multi-underlying portfolios.
  const positionQuotes = useOptionPositionQuotes(optionPositions, open, adapter);

  // Auto-settle expired legs whenever the cache learns a new underlying price.
  // Previously only the user-browsed chain triggered settlement, which left
  // expired legs on un-browsed underlyings indefinitely.
  useEffect(() => {
    if (positionQuotes.underlyingPrices.size === 0) return;
    const prices = new Map<string, Decimal>();
    for (const [u, p] of positionQuotes.underlyingPrices) {
      prices.set(u, new Decimal(p));
    }
    engine.settleExpired(prices);
  }, [positionQuotes.underlyingPrices, engine]);

  // Fetch chain when symbol or selectedExp changes. Symbol change clears exp and
  // loads the nearest expiration (the one Yahoo returns by default). Subsequent
  // exp changes refetch with ?date=.
  //
  // Market-closed policy: skip the fetch entirely. We never want to present
  // stale quotes as live. If a chain was already loaded (market closed during a
  // session), it stays frozen with the "Last updated" timestamp for context.
  useEffect(() => {
    if (!symbol) {
      setChain(null);
      setSelectedExp(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!open) {
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
        // Auto-settle any expired legs whose underlying matches this chain.
        // Uses the chain's underlyingPrice as the settlement price. Legs for
        // other underlyings stay open until their chain is loaded.
        const prices = new Map<string, Decimal>([[c.underlying, new Decimal(c.underlyingPrice)]]);
        engine.settleExpired(prices);
        // On symbol change (selectedExp === null), pin selection to what Yahoo returned.
        if (selectedExp === null) setSelectedExp(c.loadedExpiration);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ChainFetchError) {
          setError({ kind: e.kind, message: e.message });
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setError({ kind: 'unknown', message: msg });
        }
        setChain(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, selectedExp, open, engine]);

  // Reset chain + exp + legs when the user switches symbol. Legs reference
  // contracts from the previous chain, so they can't survive the swap.
  const handleSymbolChange = (s: string) => {
    setSymbol(s);
    setChain(null);
    setSelectedExp(null);
    setLegs([]);
    setFeedback(null);
  };

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
        {chain && (
          <span
            style={{
              fontSize: 11,
              color: open ? '#8a8f98' : '#f6465d',
              fontStyle: open ? 'normal' : 'italic',
            }}
            title={
              open
                ? 'Chain data timestamp from last fetch'
                : 'Market closed — chain frozen at last fetch; not live'
            }
          >
            {open ? 'Last updated' : 'Frozen'}:{' '}
            {new Date(chain.asOf * 1000).toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit',
            })}{' '}
            ET
          </span>
        )}
        {loading && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a8f98' }}>
            <Spinner />
            Loading chain…
          </span>
        )}
        {error && !loading && (
          <span style={{ fontSize: 12, color: '#f6465d' }} title={`kind: ${error.kind}`}>
            {error.message}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8a8f98' }}>
          Paper balance:{' '}
          <strong style={{ color: '#e1e4e8' }}>
            ${Number(paperBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </strong>
          {optionPositionCount > 0 && (
            <>
              {' '}· <span style={{ color: '#e1e4e8' }}>{optionPositionCount} open option leg{optionPositionCount === 1 ? '' : 's'}</span>
            </>
          )}
        </span>
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
          {symbol && !open && 'Market closed — option chains can be loaded when the market reopens.'}
          {symbol && open && loading && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Spinner />
              Loading chain for {symbol}…
            </span>
          )}
          {symbol && open && !loading && error && (
            <span style={{ color: error.kind === 'not_found' ? '#8a8f98' : '#f6465d' }}>
              {error.kind === 'not_found'
                ? `No options listed for ${symbol}. Try a different ticker.`
                : `Could not load ${symbol}: ${error.message}`}
            </span>
          )}
        </div>
      )}
      {chain && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 340px',
          alignItems: 'stretch',
        }}>
          <div style={{ minWidth: 0 }}>
            <ChainGrid chain={chain} legs={legs} onCellClick={handleCellClick} />
          </div>
          <OrderForm
            legs={legs}
            underlyingPrice={chain.underlyingPrice}
            marketOpen={open}
            feedback={feedback}
            onUpdateLeg={(i, next) => setLegs((prev) => prev.map((l, idx) => (idx === i ? next : l)))}
            onRemoveLeg={(i) => setLegs((prev) => prev.filter((_, idx) => idx !== i))}
            onClear={() => { setLegs([]); setFeedback(null); }}
            onSubmit={handleSubmit}
          />
        </div>
      )}

      <PositionsOptions
        chain={chain}
        engine={engine}
        marketOpen={open}
        quotes={positionQuotes.contracts}
        underlyingPrices={positionQuotes.underlyingPrices}
      />
    </div>
  );
}

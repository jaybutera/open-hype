import { useEffect, useMemo, useRef, useState } from 'react';
import type { OptionContract, OptionsAdapter } from '../../services/options/types.ts';
import type { OptionPositionJSON } from '../../engine/paper/options/OptionPosition.ts';

export interface PositionQuotes {
  /** Live (or last-fetched) contract data, keyed by exact contractSymbol. */
  contracts: Map<string, OptionContract>;
  /** Last-known underlying price per symbol. */
  underlyingPrices: Map<string, number>;
  /** Wall-clock seconds of the last successful fetch per (underlying, expiration). */
  asOf: Map<string, number>;
  /** Loading state per (underlying, expiration) tuple key. */
  loading: Set<string>;
}

const REFRESH_INTERVAL_MS = 30_000;

function tupleKey(underlying: string, expiration: number): string {
  return `${underlying.toUpperCase()}|${expiration}`;
}

/**
 * Fetches option chain quotes for every (underlying, expiration) tuple
 * referenced by the user's open option positions, independently of which
 * symbol the user is browsing. Returns a contract-symbol-keyed lookup so
 * positions across multiple underlyings/expirations all get live marks.
 *
 * Refresh policy: refetch every 30s while the market is open. Closed-market
 * quotes from the most recent fetch are kept for display; we don't refresh
 * them but we don't drop them either — they're labeled "frozen" in the UI.
 */
export function useOptionPositionQuotes(
  positions: OptionPositionJSON[],
  marketOpen: boolean,
  adapter: OptionsAdapter,
): PositionQuotes {
  const [contracts, setContracts] = useState<Map<string, OptionContract>>(new Map());
  const [underlyingPrices, setUnderlyingPrices] = useState<Map<string, number>>(new Map());
  const [asOf, setAsOf] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  // Keep the latest positions/marketOpen in a ref so the polling effect can
  // reread them without re-subscribing the interval.
  const positionsRef = useRef(positions);
  const marketOpenRef = useRef(marketOpen);
  positionsRef.current = positions;
  marketOpenRef.current = marketOpen;

  // Derive the unique (underlying, expiration) tuples we need to cover, as a
  // stable string so the effect dep array doesn't churn on object identity.
  const tuplesKey = useMemo(() => {
    const set = new Set<string>();
    for (const p of positions) {
      set.add(tupleKey(p.underlying, p.expiration));
    }
    return Array.from(set).sort().join(',');
  }, [positions]);

  useEffect(() => {
    if (tuplesKey === '') return;

    let cancelled = false;

    const fetchAll = async () => {
      const tuples = tuplesKey.split(',').filter(Boolean);
      // Build one fetch per tuple. Yahoo's /api/options/:symbol?date= returns
      // a chain trimmed to that single expiration's calls + puts.
      await Promise.all(
        tuples.map(async (key) => {
          const [underlying, expStr] = key.split('|');
          const expiration = Number(expStr);
          setLoading((prev) => {
            const next = new Set(prev);
            next.add(key);
            return next;
          });
          try {
            const chain = await adapter.getChain(underlying, expiration);
            if (cancelled) return;
            setContracts((prev) => {
              const next = new Map(prev);
              for (const c of chain.calls) next.set(c.symbol, c);
              for (const c of chain.puts) next.set(c.symbol, c);
              return next;
            });
            setUnderlyingPrices((prev) => {
              const next = new Map(prev);
              next.set(chain.underlying.toUpperCase(), chain.underlyingPrice);
              return next;
            });
            setAsOf((prev) => {
              const next = new Map(prev);
              next.set(key, chain.asOf);
              return next;
            });
          } catch {
            // Swallow per-tuple errors — keep last-known quotes for that tuple.
            // The position row already has a graceful "—" fallback.
          } finally {
            if (!cancelled) {
              setLoading((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
              });
            }
          }
        }),
      );
    };

    // Always fetch once on mount / when the tuple set changes — Yahoo serves
    // the last close's quotes outside RTH and the user expects to see PnL
    // there too. Only the *polling* is gated on market-open so we don't
    // hammer the proxy when prices aren't moving.
    fetchAll();
    const id = marketOpen ? setInterval(fetchAll, REFRESH_INTERVAL_MS) : null;
    return () => {
      cancelled = true;
      if (id !== null) clearInterval(id);
    };
  }, [tuplesKey, marketOpen, adapter]);

  return { contracts, underlyingPrices, asOf, loading };
}

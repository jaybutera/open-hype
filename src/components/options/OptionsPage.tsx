import { useEffect, useState } from 'react';
import { isMarketOpen, nextOpen } from '../../services/options/marketHours.ts';
import { SymbolSearch } from './SymbolSearch.tsx';

export function OptionsPage() {
  const [now, setNow] = useState(() => new Date());
  const [symbol, setSymbol] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const open = isMarketOpen(now);
  const reopen = open ? null : nextOpen(now);

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
        <SymbolSearch value={symbol} onChange={setSymbol} />
        {symbol && (
          <span style={{ fontSize: 13, color: '#8a8f98' }}>
            Loaded: <strong style={{ color: '#e1e4e8' }}>{symbol}</strong>
          </span>
        )}
      </div>

      <div style={{ padding: 24, color: '#8a8f98', fontSize: 13 }}>
        {symbol
          ? `Chain for ${symbol} will render here.`
          : 'Select a symbol above to load its option chain.'}
      </div>
    </div>
  );
}

import { useState, type CSSProperties } from 'react';
import { useGexStore } from '../../store/useGexStore.ts';
import { GEX_DTES, formatGex } from '../../services/gex/types.ts';
import { formatEt } from '../../utils/chartTime.ts';
import { lookbacksFor } from '../../services/gex/lookbacks.ts';

/** Same look as the KZ / Fib buttons in the chart toolbar. */
export function toolbarButtonStyle(active: boolean, extra?: CSSProperties): CSSProperties {
  return {
    padding: '4px 10px',
    fontSize: 12,
    background: active ? '#1a1f2e' : 'transparent',
    border: active ? '1px solid #2a2f3e' : '1px solid transparent',
    borderRadius: 4,
    color: active ? '#e1e4e8' : '#8a8f98',
    cursor: 'pointer',
    ...extra,
  };
}

interface Props {
  /** GEXBot ticker the pane's asset maps to; the toolbar renders nothing for null. */
  ticker: string | null;
  /** The pane's candle interval; sets the lookbacks the levels and γ vol outlines show. */
  interval: string;
}

/**
 * GEX layer toggles for the chart toolbar, next to KZ and Fib: the headline
 * levels, the per-strike profile (by volume or by open interest), the expiry
 * they come from, and a price offset for when the perp trades away from cash.
 */
export function GexToolbar({ ticker, interval }: Props) {
  const levels = useGexStore(s => s.levels);
  const strikes = useGexStore(s => s.strikes);
  const dte = useGexStore(s => s.dte);
  const setLevels = useGexStore(s => s.setLevels);
  const setStrikes = useGexStore(s => s.setStrikes);
  const setDte = useGexStore(s => s.setDte);
  const setOffset = useGexStore(s => s.setOffset);
  const offset = useGexStore(s => (ticker ? s.offsetFor(ticker) : 0));
  const data = useGexStore(s => (ticker ? s.current(ticker) : undefined));
  const error = useGexStore(s => (ticker ? s.errors[`${ticker}/${s.dte}`] : undefined));
  const [offsetText, setOffsetText] = useState<string | null>(null);

  if (!ticker) return null;
  const anyOn = levels || strikes !== 'off';

  const commitOffset = () => {
    if (offsetText === null) return;
    const n = parseFloat(offsetText);
    setOffset(ticker, Number.isFinite(n) ? n : 0);
    setOffsetText(null);
  };

  return (
    <span data-testid="gex-toolbar" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 8 }}>
      <span style={{ fontSize: 11, color: '#555', marginRight: 2 }} title={`GEXBot ticker for ${ticker}`}>GEX</span>
      <button
        onClick={() => setLevels(!levels)}
        title={`Zero gamma and the major positive/negative gamma strikes, by volume (solid) and open interest (dashed), plus the volume majors ${lookbacksFor(interval)[0].minutes} and ${lookbacksFor(interval)[1].minutes} minutes ago when they differ (faint dotted)`}
        style={toolbarButtonStyle(levels)}
      >
        Levels
      </button>
      <button
        onClick={() => setStrikes(strikes === 'vol' ? 'off' : 'vol')}
        title={`Per-strike gamma exposure from today's traded volume, as bars off the price axis; the thinner rows under each bar are the bar ${lookbacksFor(interval)[0].minutes} and ${lookbacksFor(interval)[1].minutes} minutes ago for this interval`}
        style={toolbarButtonStyle(strikes === 'vol')}
      >
        γ vol
      </button>
      <button
        onClick={() => setStrikes(strikes === 'oi' ? 'off' : 'oi')}
        title="Per-strike gamma exposure from open interest (positions carried from before today), as bars off the price axis"
        style={toolbarButtonStyle(strikes === 'oi')}
      >
        γ OI
      </button>
      {anyOn && (
        <>
          <span style={{ display: 'inline-flex', marginLeft: 4 }}>
            {GEX_DTES.map(d => (
              <button
                key={d.id}
                onClick={() => setDte(d.id)}
                title={d.title}
                style={toolbarButtonStyle(dte === d.id, { padding: '4px 7px', fontSize: 11 })}
              >
                {d.label}
              </button>
            ))}
          </span>
          <label
            title="Added to every GEXBot price before drawing; use it when the perp trades away from cash"
            style={{ fontSize: 11, color: '#555', display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4 }}
          >
            offset
            <input
              type="number"
              step="any"
              value={offsetText ?? (offset === 0 ? '' : String(offset))}
              placeholder="0"
              onChange={e => setOffsetText(e.target.value)}
              onBlur={commitOffset}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              style={{ width: 56, fontSize: 11, padding: '3px 4px', background: '#0a0e17', color: '#e1e4e8', border: '1px solid #2a2f3e', borderRadius: 4 }}
            />
          </label>
          {data && (
            <span
              style={{ fontSize: 11, color: '#555', marginLeft: 6 }}
              title={`GEXBot reading at ${formatEt(data.timestamp)}; it stops updating after the close. Spot ${data.spot}, net GEX ${formatGex(data.sumGexVol)} by volume / ${formatGex(data.sumGexOi)} by OI`}
            >
              {formatEt(data.timestamp).slice(11, 16)} ET
            </span>
          )}
          {error && <span style={{ fontSize: 11, color: '#f6465d', marginLeft: 6 }} title={error}>GEX error</span>}
        </>
      )}
    </span>
  );
}

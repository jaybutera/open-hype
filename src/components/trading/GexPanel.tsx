import { useState } from 'react';
import { useGexStore } from '../../store/useGexStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { GEX_DTES, formatGex } from '../../services/gex/types.ts';
import { formatEt } from '../../utils/chartTime.ts';

const chip = { fontSize: 11, padding: '3px 6px' } as const;

/**
 * GEX layers for the active pane's asset: the headline levels, the per-strike
 * profile, and which expiry they come from. Shown only when the asset's
 * options are on GEXBot (xyz:SP500 -> SPX, xyz:XYZ100 -> NDX, xyz:TSLA -> TSLA...).
 */
export function GexPanel() {
  const asset = useMarketStore(s => s.getActivePane().asset);
  const ticker = useGexStore(s => s.tickerFor(asset));
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
    <div data-testid="gex-panel" style={{ borderTop: '1px solid #1a1f2e', paddingTop: 8, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#8a8f98', fontWeight: 600 }}>GEX · {ticker}</span>
        {data && anyOn && (
          <span style={{ fontSize: 10, color: '#555' }} title="Time of the GEXBot reading; it stops updating after the close">
            as of {formatEt(data.timestamp).slice(11)}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>
          {GEX_DTES.map(d => (
            <button
              key={d.id}
              className={`btn-toggle${dte === d.id ? ' active' : ''}`}
              aria-pressed={dte === d.id}
              title={d.title}
              onClick={() => setDte(d.id)}
              style={{ fontSize: 10, padding: '2px 5px' }}
            >
              {d.label}
            </button>
          ))}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        <button
          className={`btn-toggle${levels ? ' active' : ''}`}
          aria-pressed={levels}
          title="Zero gamma and the major positive/negative strikes by volume and open interest"
          onClick={() => setLevels(!levels)}
          style={{ ...chip, borderLeft: '2px solid #c9ced6' }}
        >
          Levels
        </button>
        <button
          className={`btn-toggle${strikes === 'vol' ? ' active' : ''}`}
          aria-pressed={strikes === 'vol'}
          title="Per-strike gamma exposure from today's volume"
          onClick={() => setStrikes(strikes === 'vol' ? 'off' : 'vol')}
          style={{ ...chip, borderLeft: '2px solid #0ecb81' }}
        >
          Strikes vol
        </button>
        <button
          className={`btn-toggle${strikes === 'oi' ? ' active' : ''}`}
          aria-pressed={strikes === 'oi'}
          title="Per-strike gamma exposure from open interest"
          onClick={() => setStrikes(strikes === 'oi' ? 'off' : 'oi')}
          style={{ ...chip, borderLeft: '2px solid #f6465d' }}
        >
          Strikes OI
        </button>
        <label
          title="Added to every GEXBot price before drawing; use it when the perp trades away from cash"
          style={{ fontSize: 10, color: '#555', display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}
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
            style={{ width: 52, fontSize: 10, padding: '2px 4px', background: '#0a0e17', color: '#e1e4e8', border: '1px solid #2a2f3e' }}
          />
        </label>
      </div>
      {anyOn && data && (
        <div style={{ fontSize: 10, color: '#8a8f98', marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span title="GEXBot spot at the reading">spot {data.spot}</span>
          <span title="Zero gamma">0γ {data.zeroGamma}</span>
          <span title="Net gamma exposure by volume / by open interest">
            net {formatGex(data.sumGexVol)} / {formatGex(data.sumGexOi)}
          </span>
        </div>
      )}
      {anyOn && error && <div style={{ fontSize: 10, color: '#f6465d', marginTop: 4 }}>GEX: {error}</div>}
    </div>
  );
}

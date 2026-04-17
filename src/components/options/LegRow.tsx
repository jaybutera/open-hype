import type { Leg, LegSide } from '../../services/options/types.ts';
import { legMark } from '../../services/options/netSummary.ts';

interface Props {
  leg: Leg;
  onSideChange: (side: LegSide) => void;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
}

function fmtStrike(s: number): string {
  return s % 1 === 0 ? s.toFixed(0) : s.toFixed(2);
}

function fmtExpiration(expiration: number): string {
  const d = new Date(expiration * 1000);
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
  });
}

export function LegRow({ leg, onSideChange, onQtyChange, onRemove }: Props) {
  const { contract, side, qty } = leg;
  const { mark, reliable } = legMark(leg);
  const typeLabel = contract.type === 'call' ? 'Call' : 'Put';
  const contractLabel = `${contract.underlying} ${fmtExpiration(contract.expiration)} $${fmtStrike(contract.strike)} ${typeLabel}`;

  const buyActive = side === 'buy';
  const sellActive = side === 'sell';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '74px 1fr auto auto',
        gap: 8,
        alignItems: 'center',
        padding: '8px 10px',
        borderBottom: '1px solid #1a1f2e',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', border: '1px solid #2a2f3e' }}>
        <button
          type="button"
          onClick={() => onSideChange('buy')}
          style={{
            flex: 1,
            padding: '2px 0',
            background: buyActive ? 'rgba(246,70,93,0.18)' : 'transparent',
            color: buyActive ? '#f6465d' : '#8a8f98',
            border: 'none',
            borderRight: '1px solid #2a2f3e',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: 'pointer',
          }}
        >
          BUY
        </button>
        <button
          type="button"
          onClick={() => onSideChange('sell')}
          style={{
            flex: 1,
            padding: '2px 0',
            background: sellActive ? 'rgba(14,203,129,0.18)' : 'transparent',
            color: sellActive ? '#0ecb81' : '#8a8f98',
            border: 'none',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: 'pointer',
          }}
        >
          SELL
        </button>
      </div>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            color: '#e1e4e8',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {contractLabel}
        </span>
        <span style={{ color: reliable ? '#8a8f98' : '#f6465d', fontSize: 11 }}>
          Mark {mark > 0 ? `$${mark.toFixed(2)}` : '—'}
          {!reliable && mark > 0 && <span style={{ marginLeft: 4 }}>(one-sided)</span>}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #2a2f3e' }}>
        <button
          type="button"
          onClick={() => onQtyChange(Math.max(1, qty - 1))}
          disabled={qty <= 1}
          style={{
            padding: '2px 6px',
            background: 'transparent',
            border: 'none',
            color: qty <= 1 ? '#3d4250' : '#8a8f98',
            cursor: qty <= 1 ? 'default' : 'pointer',
            fontSize: 12,
          }}
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={9999}
          value={qty}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isFinite(n)) return;
            onQtyChange(Math.min(9999, Math.max(1, n)));
          }}
          style={{
            width: 40,
            textAlign: 'center',
            background: 'transparent',
            border: 'none',
            borderLeft: '1px solid #2a2f3e',
            borderRight: '1px solid #2a2f3e',
            color: '#e1e4e8',
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            padding: '2px 0',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => onQtyChange(Math.min(9999, qty + 1))}
          style={{
            padding: '2px 6px',
            background: 'transparent',
            border: 'none',
            color: '#8a8f98',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          +
        </button>
      </div>

      <button
        type="button"
        onClick={onRemove}
        title="Remove leg"
        style={{
          padding: '2px 8px',
          background: 'transparent',
          border: '1px solid #2a2f3e',
          color: '#8a8f98',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        ×
      </button>
    </div>
  );
}

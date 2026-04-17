import { useMemo } from 'react';
import type { Leg } from '../../services/options/types.ts';
import {
  CONTRACT_MULTIPLIER,
  netGreeks,
  netPerShare,
} from '../../services/options/netSummary.ts';

interface Props {
  legs: Leg[];
  underlyingPrice: number;
  qtyScalar: number;
}

function fmtSigned(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(digits);
  if (n > 0) return `+${s}`;
  return s;
}

function fmtDollar(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n >= 0 ? '' : '-';
  return `${sign}$${abs.toFixed(2)}`;
}

export function NetSummary({ legs, underlyingPrice, qtyScalar }: Props) {
  const perShare = useMemo(() => netPerShare(legs), [legs]);
  const total = perShare * CONTRACT_MULTIPLIER * qtyScalar;
  const direction = perShare === 0 ? 'Even' : perShare > 0 ? 'Debit' : 'Credit';
  const directionColor = perShare > 0 ? '#f6465d' : perShare < 0 ? '#0ecb81' : '#8a8f98';

  const greeks = useMemo(
    () => netGreeks(legs, underlyingPrice),
    [legs, underlyingPrice],
  );

  if (legs.length === 0) {
    return (
      <div style={{ padding: 12, color: '#8a8f98', fontSize: 12 }}>
        Click a bid or ask cell in the chain to build a position.
      </div>
    );
  }

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid #1a1f2e',
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 11, color: '#8a8f98', letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700 }}>
          Net {direction}
        </span>
        <span style={{ color: directionColor, fontWeight: 700, fontSize: 14 }}>
          {fmtDollar(Math.abs(total))}
        </span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '4px 12px',
        color: '#8a8f98',
      }}>
        <span>Per contract</span>
        <span style={{ color: directionColor, textAlign: 'right' }}>
          {fmtDollar(Math.abs(perShare * CONTRACT_MULTIPLIER))}
        </span>
        <span>Per share</span>
        <span style={{ color: directionColor, textAlign: 'right' }}>
          {fmtDollar(Math.abs(perShare))}
        </span>
      </div>

      <div style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: '1px solid #1a1f2e',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '4px 12px',
        color: '#8a8f98',
      }}>
        <span style={{ gridColumn: '1 / -1', fontSize: 10, color: '#8a8f98', letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>
          Net Greeks
        </span>
        <span>Δ Delta</span>
        <span style={{ color: '#e1e4e8', textAlign: 'right' }}>{fmtSigned(greeks.delta, 3)}</span>
        <span>Γ Gamma</span>
        <span style={{ color: '#e1e4e8', textAlign: 'right' }}>{fmtSigned(greeks.gamma, 4)}</span>
        <span>ν Vega</span>
        <span style={{ color: '#e1e4e8', textAlign: 'right' }}>{fmtSigned(greeks.vega, 3)}</span>
        <span>Θ Theta</span>
        <span style={{ color: '#e1e4e8', textAlign: 'right' }}>{fmtSigned(greeks.theta, 3)}</span>
        <span>ρ Rho</span>
        <span style={{ color: '#e1e4e8', textAlign: 'right' }}>{fmtSigned(greeks.rho, 3)}</span>
      </div>
    </div>
  );
}

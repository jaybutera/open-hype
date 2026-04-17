import { useEffect, useMemo, useState } from 'react';
import type { Leg, LegSide } from '../../services/options/types.ts';
import {
  CONTRACT_MULTIPLIER,
  netPerShare,
} from '../../services/options/netSummary.ts';
import { MAX_LEGS } from '../../services/options/legs.ts';
import { LegRow } from './LegRow.tsx';
import { NetSummary } from './NetSummary.tsx';

export type OrderType = 'limit' | 'market';

interface Props {
  legs: Leg[];
  underlyingPrice: number;
  marketOpen: boolean;
  onUpdateLeg: (index: number, next: Leg) => void;
  onRemoveLeg: (index: number) => void;
  onClear: () => void;
  onSubmit: (order: { orderType: OrderType; limitPrice: number | null; qtyScalar: number }) => void;
}

function strategyLabel(legs: Leg[]): string {
  if (legs.length === 0) return '';
  if (legs.length === 1) {
    const [l] = legs;
    const verb = l.side === 'buy' ? 'Long' : 'Short';
    return `${verb} ${l.contract.type === 'call' ? 'Call' : 'Put'}`;
  }
  return `${legs.length}-leg spread`;
}

export function OrderForm({
  legs, underlyingPrice, marketOpen,
  onUpdateLeg, onRemoveLeg, onClear, onSubmit,
}: Props) {
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [qtyScalar, setQtyScalar] = useState(1);
  // null = auto-default to net mid. User-typed number takes precedence.
  const [limitOverride, setLimitOverride] = useState<number | null>(null);

  const perShare = useMemo(() => netPerShare(legs), [legs]);
  const suggestedLimit = perShare;
  const limitPrice = limitOverride ?? suggestedLimit;

  // Reset any limit override when legs change materially (e.g. user adds/removes
  // a leg) — keep it sticky only while legs are stable.
  useEffect(() => {
    setLimitOverride(null);
  }, [legs.length]);

  const totalCost = limitPrice * CONTRACT_MULTIPLIER * qtyScalar;
  const isDebit = limitPrice > 0;
  const isCredit = limitPrice < 0;
  const submittable = marketOpen && legs.length > 0;

  const handleSideChange = (index: number, side: LegSide) => {
    const l = legs[index];
    onUpdateLeg(index, { ...l, side });
  };
  const handleQtyChange = (index: number, qty: number) => {
    const l = legs[index];
    onUpdateLeg(index, { ...l, qty });
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid #1a1f2e',
      background: '#0d1117',
      height: '100%',
      minHeight: 0,
    }}>
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid #1a1f2e',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e1e4e8' }}>
            Order {legs.length > 0 && <span style={{ color: '#8a8f98', fontWeight: 500 }}>· {strategyLabel(legs)}</span>}
          </span>
          <span style={{ fontSize: 11, color: '#8a8f98' }}>
            {legs.length} / {MAX_LEGS} legs
          </span>
        </div>
        {legs.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            style={{
              background: 'transparent', border: '1px solid #2a2f3e',
              color: '#8a8f98', padding: '3px 8px', fontSize: 11,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {legs.length === 0 ? (
          <div style={{ padding: 16, color: '#8a8f98', fontSize: 12 }}>
            No legs selected. Click a <span style={{ color: '#0ecb81' }}>bid</span> cell to sell
            or an <span style={{ color: '#f6465d' }}>ask</span> cell to buy. Up to {MAX_LEGS} legs.
          </div>
        ) : (
          legs.map((leg, i) => (
            <LegRow
              key={`${leg.contract.symbol}:${i}`}
              leg={leg}
              onSideChange={(side) => handleSideChange(i, side)}
              onQtyChange={(qty) => handleQtyChange(i, qty)}
              onRemove={() => onRemoveLeg(i)}
            />
          ))
        )}
      </div>

      <NetSummary legs={legs} underlyingPrice={underlyingPrice} qtyScalar={qtyScalar} />

      {legs.length > 0 && (
        <div style={{
          padding: '10px 12px', borderTop: '1px solid #1a1f2e',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          fontSize: 12,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ color: '#8a8f98', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700 }}>
              Type
            </span>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
              style={{
                background: '#141820', color: '#e1e4e8',
                border: '1px solid #2a2f3e', padding: '4px 6px',
                fontSize: 12, fontFamily: 'inherit',
              }}
            >
              <option value="limit">Limit</option>
              <option value="market">Market</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ color: '#8a8f98', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700 }}>
              Qty ×
            </span>
            <input
              type="number"
              min={1}
              max={9999}
              value={qtyScalar}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isFinite(n)) return;
                setQtyScalar(Math.min(9999, Math.max(1, n)));
              }}
              style={{
                background: '#141820', color: '#e1e4e8',
                border: '1px solid #2a2f3e', padding: '4px 6px',
                fontSize: 12, fontFamily: 'inherit',
              }}
            />
          </label>

          {orderType === 'limit' && (
            <label style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ color: '#8a8f98', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700 }}>
                Limit (per share · default = net mid)
              </span>
              <input
                type="number"
                step={0.01}
                value={limitPrice.toFixed(2)}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setLimitOverride(Number.isFinite(n) ? n : null);
                }}
                style={{
                  background: '#141820', color: '#e1e4e8',
                  border: '1px solid #2a2f3e', padding: '4px 6px',
                  fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              />
              <span style={{ fontSize: 10, color: '#8a8f98' }}>
                Total {isDebit ? 'debit' : isCredit ? 'credit' : 'cost'}:{' '}
                <span style={{ color: isDebit ? '#f6465d' : isCredit ? '#0ecb81' : '#8a8f98' }}>
                  ${Math.abs(totalCost).toFixed(2)}
                </span>
              </span>
            </label>
          )}

          <button
            type="button"
            onClick={() => onSubmit({ orderType, limitPrice: orderType === 'limit' ? limitPrice : null, qtyScalar })}
            disabled={!submittable}
            style={{
              gridColumn: '1 / -1',
              marginTop: 4,
              padding: '8px 0',
              background: submittable ? '#3861fb' : '#1a1f2e',
              color: submittable ? '#ffffff' : '#8a8f98',
              border: 'none',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              cursor: submittable ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            {legs.length === 1
              ? (legs[0].side === 'buy' ? 'Buy to Open' : 'Sell to Open')
              : 'Open Spread'}
          </button>
          {!marketOpen && (
            <span style={{ gridColumn: '1 / -1', fontSize: 10, color: '#f6465d', textAlign: 'center' }}>
              Market closed — submission disabled.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

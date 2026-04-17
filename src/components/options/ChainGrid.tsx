import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Leg, OptionChain, OptionContract } from '../../services/options/types.ts';
import { MAX_LEGS } from '../../services/options/legs.ts';
import {
  ALL_METRICS,
  CHAIN_METRICS,
  type ChainMetricKey,
  loadChainMetrics,
  saveChainMetrics,
  toggleMetric,
} from '../../services/options/chainMetrics.ts';
import { ChainRow } from './ChainRow.tsx';

interface Props {
  chain: OptionChain;
  legs: Leg[];
  onCellClick: (contract: OptionContract, side: 'buy' | 'sell') => void;
}

interface StrikeRow {
  strike: number;
  call?: OptionContract;
  put?: OptionContract;
}

export function buildStrikeRows(chain: OptionChain): StrikeRow[] {
  // Union of strikes that actually have a call OR a put for the loaded expiration.
  // Yahoo's `chain.strikes` is the full symbol-wide strike list; we narrow to the
  // strikes that have a contract on the current expiration.
  const byStrike = new Map<number, StrikeRow>();
  for (const c of chain.calls) {
    const row = byStrike.get(c.strike) ?? { strike: c.strike };
    row.call = c;
    byStrike.set(c.strike, row);
  }
  for (const p of chain.puts) {
    const row = byStrike.get(p.strike) ?? { strike: p.strike };
    row.put = p;
    byStrike.set(p.strike, row);
  }
  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
}

const HEADER_CELL: React.CSSProperties = {
  padding: '8px',
  fontSize: 10,
  fontWeight: 700,
  color: '#8a8f98',
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  background: '#0d1117',
  borderBottom: '1px solid #2a2f3e',
};

function metricHeaderLabel(key: ChainMetricKey): string {
  return CHAIN_METRICS[key].label;
}

export function ChainGrid({ chain, legs, onCellClick }: Props) {
  const rows = useMemo(() => buildStrikeRows(chain), [chain]);
  const atCapacity = legs.length >= MAX_LEGS;
  const [metrics, setMetrics] = useState<[ChainMetricKey, ChainMetricKey]>(() => loadChainMetrics());

  useEffect(() => {
    saveChainMetrics(metrics);
  }, [metrics]);

  const onToggleMetric = useCallback((key: ChainMetricKey) => {
    setMetrics((prev) => toggleMetric(prev, key));
  }, []);

  if (rows.length === 0) {
    return (
      <div style={{ padding: 24, color: '#8a8f98', fontSize: 13 }}>
        No strikes available for this expiration.
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 16px 24px 16px' }}>
      {atCapacity && (
        <div
          role="status"
          style={{
            padding: '6px 10px',
            marginBottom: 8,
            fontSize: 12,
            fontWeight: 600,
            color: '#f0b90b',
            background: 'rgba(240,185,11,0.10)',
            border: '1px solid rgba(240,185,11,0.35)',
            letterSpacing: 0.3,
          }}
        >
          4-leg cap reached — remove a leg in the order form or click a selected
          cell to deselect it before adding another.
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 0 8px 0',
          fontSize: 11,
          color: '#8a8f98',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        <span>Calls</span>
        <MetricPicker metrics={metrics} onToggle={onToggleMetric} />
        <span>Puts</span>
      </div>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <colgroup>
          <col style={{ width: '9%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '9%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...HEADER_CELL, textAlign: 'right' }}>{metricHeaderLabel(metrics[0])}</th>
            <th style={{ ...HEADER_CELL, textAlign: 'right' }}>{metricHeaderLabel(metrics[1])}</th>
            <th style={{ ...HEADER_CELL, textAlign: 'right', color: '#0ecb81' }}>Bid</th>
            <th style={{ ...HEADER_CELL, textAlign: 'right', color: '#f6465d' }}>Ask</th>
            <th style={{ ...HEADER_CELL, textAlign: 'center', color: '#e1e4e8' }}>Strike</th>
            <th style={{ ...HEADER_CELL, textAlign: 'left', color: '#0ecb81' }}>Bid</th>
            <th style={{ ...HEADER_CELL, textAlign: 'left', color: '#f6465d' }}>Ask</th>
            <th style={{ ...HEADER_CELL, textAlign: 'left' }}>{metricHeaderLabel(metrics[1])}</th>
            <th style={{ ...HEADER_CELL, textAlign: 'left' }}>{metricHeaderLabel(metrics[0])}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <ChainRow
              key={r.strike}
              strike={r.strike}
              call={r.call}
              put={r.put}
              underlyingPrice={chain.underlyingPrice}
              legs={legs}
              onCellClick={onCellClick}
              atCapacity={atCapacity}
              metrics={metrics}
              nowSec={chain.asOf}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PickerProps {
  metrics: [ChainMetricKey, ChainMetricKey];
  onToggle: (key: ChainMetricKey) => void;
}

function MetricPicker({ metrics, onToggle }: PickerProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, textTransform: 'none', letterSpacing: 0 }}>
      <span style={{ fontSize: 10, color: '#5a5f68', marginRight: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        Columns
      </span>
      {ALL_METRICS.map((k) => {
        const active = metrics.includes(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => onToggle(k)}
            title={CHAIN_METRICS[k].description}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              background: active ? 'rgba(56,97,251,0.18)' : 'transparent',
              color: active ? '#e1e4e8' : '#8a8f98',
              border: `1px solid ${active ? '#3861fb' : '#2a2f3e'}`,
              cursor: 'pointer',
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              borderRadius: 0,
            }}
          >
            {CHAIN_METRICS[k].label}
          </button>
        );
      })}
    </div>
  );
}

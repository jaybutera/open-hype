import { useMemo } from 'react';
import type { Leg, OptionChain, OptionContract } from '../../services/options/types.ts';
import { MAX_LEGS } from '../../services/options/legs.ts';
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

export function ChainGrid({ chain, legs, onCellClick }: Props) {
  const rows = useMemo(() => buildStrikeRows(chain), [chain]);
  const atCapacity = legs.length >= MAX_LEGS;

  if (rows.length === 0) {
    return (
      <div style={{ padding: 24, color: '#8a8f98', fontSize: 13 }}>
        No strikes available for this expiration.
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 16px 24px 16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '4px 0 8px 0',
          fontSize: 11,
          color: '#8a8f98',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        <span>Calls</span>
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
            <th style={{ ...HEADER_CELL, textAlign: 'right' }}>IV</th>
            <th style={{ ...HEADER_CELL, textAlign: 'right' }}>OI</th>
            <th style={{ ...HEADER_CELL, textAlign: 'right', color: '#0ecb81' }}>Bid</th>
            <th style={{ ...HEADER_CELL, textAlign: 'right', color: '#f6465d' }}>Ask</th>
            <th style={{ ...HEADER_CELL, textAlign: 'center', color: '#e1e4e8' }}>Strike</th>
            <th style={{ ...HEADER_CELL, textAlign: 'left', color: '#0ecb81' }}>Bid</th>
            <th style={{ ...HEADER_CELL, textAlign: 'left', color: '#f6465d' }}>Ask</th>
            <th style={{ ...HEADER_CELL, textAlign: 'left' }}>OI</th>
            <th style={{ ...HEADER_CELL, textAlign: 'left' }}>IV</th>
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
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

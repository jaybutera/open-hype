import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { useAccountStore } from '../../store/useAccountStore.ts';
import type { OptionChain } from '../../services/options/types.ts';
import {
  deserializeOptionPosition,
  groupBySpread,
  legCostBasis,
  legUnrealizedPnl,
  type OptionPosition,
} from '../../engine/paper/options/OptionPosition.ts';
import {
  detectSimpleStrategy,
  spreadCurrentMark,
  spreadEntryBasis,
  spreadNearestDte,
  spreadFarthestDte,
  spreadNetGreeksFromChain,
  spreadUnrealizedPnl,
} from '../../engine/paper/options/spreadSummary.ts';

interface Props {
  chain: OptionChain | null;
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSigned(v: number): string {
  if (v === 0) return '$0.00';
  return `${v > 0 ? '+' : '−'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtStrike(s: number): string {
  return s % 1 === 0 ? s.toFixed(0) : s.toFixed(2);
}

function fmtExpiration(expiration: number): string {
  const d = new Date(expiration * 1000);
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtDte(dte: number): string {
  if (dte < 0) return `${dte}d (expired)`;
  if (dte === 0) return 'today';
  return `${dte}d`;
}

function fmtGreek(v: number, decimals: number = 3): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(decimals);
  return v > 0 ? `+${s}` : s;
}

interface SpreadRowProps {
  legs: OptionPosition[];
  chain: OptionChain | null;
  expanded: boolean;
  onToggle: () => void;
}

function SpreadRow({ legs, chain, expanded, onToggle }: SpreadRowProps) {
  const firstLeg = legs[0];
  const underlying = firstLeg.underlying;
  const chainMatches = chain && chain.underlying.toUpperCase() === underlying.toUpperCase();
  const entry = spreadEntryBasis(legs);
  const mark = spreadCurrentMark(legs, chain);
  const pnl = spreadUnrealizedPnl(legs, chain);
  const greeks = spreadNetGreeksFromChain(legs, chain);
  const nearest = spreadNearestDte(legs);
  const farthest = spreadFarthestDte(legs);
  const strategy = detectSimpleStrategy(legs);

  const entryNum = entry.toNumber();
  const entryLabel = entryNum > 0 ? 'Debit' : entryNum < 0 ? 'Credit' : 'Even';
  const entryColor = entryNum > 0 ? '#f6465d' : entryNum < 0 ? '#0ecb81' : '#8a8f98';
  const pnlNum = pnl.toNumber();
  const pnlColor = pnlNum > 0 ? '#0ecb81' : pnlNum < 0 ? '#f6465d' : '#8a8f98';
  const dteLabel = nearest === farthest ? fmtDte(nearest) : `${fmtDte(nearest)} → ${fmtDte(farthest)}`;

  return (
    <div style={{ borderBottom: '1px solid #1a1f2e' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '16px 120px 1fr 100px 100px 120px 100px',
          gap: 12,
          alignItems: 'center',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          color: '#e1e4e8',
          fontSize: 12,
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ color: '#8a8f98', fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600 }}>{underlying}</span>
        <span style={{ color: '#8a8f98' }}>
          {strategy} · {legs.length} leg{legs.length === 1 ? '' : 's'}
        </span>
        <span style={{ color: entryColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {entryLabel} {fmtUsd(Math.abs(entryNum))}
        </span>
        <span style={{ color: '#e1e4e8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {chainMatches ? fmtUsd(Math.abs(mark.netMarkTotal.toNumber())) : '—'}
        </span>
        <span style={{ color: pnlColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {chainMatches && mark.legsPriced > 0 ? fmtSigned(pnlNum) : '—'}
        </span>
        <span style={{ color: '#8a8f98' }}>{dteLabel}</span>
      </button>

      {expanded && (
        <div style={{ padding: '8px 14px 12px', background: '#0a0d14' }}>
          {chainMatches && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 8,
                padding: '6px 8px',
                marginBottom: 8,
                background: '#111622',
                border: '1px solid #1a1f2e',
              }}
            >
              {[
                ['Δ', greeks.delta, 3],
                ['Γ', greeks.gamma, 4],
                ['ν', greeks.vega, 3],
                ['Θ', greeks.theta, 3],
                ['ρ', greeks.rho, 3],
              ].map(([label, value, decimals]) => (
                <div key={label as string} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: '#8a8f98', fontSize: 10 }}>{label as string}</span>
                  <span
                    style={{
                      color: '#e1e4e8',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 11,
                    }}
                  >
                    {fmtGreek(value as number, decimals as number)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {legs.map((l) => {
              const long = l.szi.isPositive();
              const sideLabel = long ? 'LONG' : 'SHORT';
              const sideColor = long ? '#0ecb81' : '#f6465d';
              const cost = legCostBasis(l).toNumber();
              const qty = l.szi.abs().toNumber();
              const pool = chainMatches && chain ? (l.type === 'call' ? chain.calls : chain.puts) : null;
              const hit = pool ? pool.find((c) => c.symbol === l.contractSymbol) : null;
              const liveMid = hit && hit.bid > 0 && hit.ask > 0 ? (hit.bid + hit.ask) / 2 : null;
              const legPnl =
                liveMid !== null ? legUnrealizedPnl(l, new Decimal(liveMid)).toNumber() : null;
              return (
                <div
                  key={l.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr 90px 90px 90px',
                    gap: 12,
                    alignItems: 'center',
                    padding: '4px 8px',
                    fontSize: 11,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: '#e1e4e8',
                  }}
                >
                  <span style={{ color: sideColor, fontWeight: 700 }}>
                    {sideLabel} {qty}
                  </span>
                  <span style={{ color: '#8a8f98' }}>
                    {l.underlying} {fmtExpiration(l.expiration)} ${fmtStrike(l.strike.toNumber())}{' '}
                    {l.type === 'call' ? 'Call' : 'Put'}
                  </span>
                  <span>Entry ${l.entryPx.toFixed(2)}</span>
                  <span style={{ color: '#8a8f98' }}>
                    Basis {fmtSigned(cost)}
                  </span>
                  <span style={{ color: legPnl === null ? '#8a8f98' : legPnl >= 0 ? '#0ecb81' : '#f6465d' }}>
                    {legPnl === null ? '—' : fmtSigned(legPnl)}
                  </span>
                </div>
              );
            })}
          </div>
          {!chainMatches && (
            <div style={{ marginTop: 6, color: '#8a8f98', fontSize: 11, fontStyle: 'italic' }}>
              Load {underlying}'s chain above to see live marks and unrealized PnL.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PositionsOptions({ chain }: Props) {
  const rawPositions = useAccountStore((s) => s.paperOptionPositions);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const positions = rawPositions.map(deserializeOptionPosition);
    const groups = groupBySpread(positions);
    // Sort spreads by earliest-opened first (stable-ish under add/remove).
    return Array.from(groups.entries()).sort((a, b) => {
      const aOpened = Math.min(...a[1].map((p) => p.openedAt));
      const bOpened = Math.min(...b[1].map((p) => p.openedAt));
      return aOpened - bOpened;
    });
  }, [rawPositions]);

  if (grouped.length === 0) {
    return (
      <div
        style={{
          padding: '16px',
          borderTop: '1px solid #1a1f2e',
          color: '#8a8f98',
          fontSize: 12,
          fontStyle: 'italic',
        }}
      >
        No open option positions.
      </div>
    );
  }

  const toggle = (spreadId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(spreadId)) next.delete(spreadId);
      else next.add(spreadId);
      return next;
    });
  };

  return (
    <div style={{ borderTop: '1px solid #1a1f2e' }}>
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid #1a1f2e',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.5,
          color: '#8a8f98',
          textTransform: 'uppercase',
          background: '#111622',
        }}
      >
        Open Option Positions ({grouped.length})
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '16px 120px 1fr 100px 100px 120px 100px',
          gap: 12,
          padding: '6px 14px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
          color: '#8a8f98',
          textTransform: 'uppercase',
          borderBottom: '1px solid #1a1f2e',
        }}
      >
        <span></span>
        <span>Symbol</span>
        <span>Strategy</span>
        <span>Entry</span>
        <span>Mark</span>
        <span>PnL</span>
        <span>DTE</span>
      </div>
      {grouped.map(([spreadId, legs]) => (
        <SpreadRow
          key={spreadId}
          legs={legs}
          chain={chain}
          expanded={expanded.has(spreadId)}
          onToggle={() => toggle(spreadId)}
        />
      ))}
    </div>
  );
}

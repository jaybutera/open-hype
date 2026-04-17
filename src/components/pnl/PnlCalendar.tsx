import { useState, useMemo, Fragment } from 'react';
import { usePaperAccountsStore } from '../../store/usePaperAccountsStore.ts';
import type { LedgerEntry, LedgerKind } from '../../engine/paper/ledger.ts';
import { formatContractLabel } from '../../services/options/occSymbol.ts';
import {
  groupFillsForDay,
  lifecycleVerb,
  type SpreadFillGroup,
} from '../../services/options/pnlFillGroups.ts';

function isOptionKind(kind: LedgerKind | undefined): boolean {
  return kind === 'option-open' || kind === 'option-close' || kind === 'option-expire';
}

function optionSideLabel(kind: LedgerKind | undefined, side: 'buy' | 'sell'): string {
  if (kind === 'option-open') return side === 'buy' ? 'BTO' : 'STO';
  if (kind === 'option-close') return side === 'buy' ? 'BTC' : 'STC';
  if (kind === 'option-expire') return 'EXP';
  return side.toUpperCase();
}

function optionSideColor(kind: LedgerKind | undefined, side: 'buy' | 'sell'): string {
  if (kind === 'option-expire') return '#8a8f98';
  return side === 'buy' ? '#0ecb81' : '#f6465d';
}

function fmtSignedDollars(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+$${abs}`;
  if (n < 0) return `-$${abs}`;
  return `$${abs}`;
}

function premiumLabel(lifecycle: SpreadFillGroup['lifecycle'], netPremium: number): string {
  // Opens: if net credit (positive), say "credit"; if net debit (negative), say "debit"
  // Closes/expires: just show signed net cash flow (no debit/credit labeling since
  // these are realized-side flows, not upfront basis)
  if (lifecycle === 'option-open') {
    if (netPremium > 0) return `net credit $${netPremium.toFixed(2)}`;
    if (netPremium < 0) return `net debit $${Math.abs(netPremium).toFixed(2)}`;
    return 'net $0.00';
  }
  return `net ${fmtSignedDollars(netPremium)}`;
}

interface DayData {
  date: string; // YYYY-MM-DD
  pnl: number;
  fees: number;
  trades: LedgerEntry[];
}

function groupFillsByDay(fills: LedgerEntry[]): Map<string, DayData> {
  const map = new Map<string, DayData>();
  for (const fill of fills) {
    const date = new Date(fill.timestamp).toLocaleDateString('en-CA'); // YYYY-MM-DD
    const existing = map.get(date);
    const pnl = parseFloat(fill.realizedPnl);
    const fee = parseFloat(fill.fee);
    if (existing) {
      existing.pnl += pnl;
      existing.fees += fee;
      existing.trades.push(fill);
    } else {
      map.set(date, { date, pnl, fees: fee, trades: [fill] });
    }
  }
  return map;
}

function getMonthDays(year: number, month: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];

  // Fill leading days from previous month
  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, inMonth: false });
  }
  // Days in month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  // Fill trailing days
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }
  return cells;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PnlCalendar() {
  const account = usePaperAccountsStore(s => s.getActiveAccount());
  const fills = account.fills;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [expandedSpreads, setExpandedSpreads] = useState<Set<string>>(new Set());

  const toggleSpread = (key: string) => {
    setExpandedSpreads(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dailyData = useMemo(() => groupFillsByDay(fills), [fills]);
  const days = useMemo(() => getMonthDays(year, month), [year, month]);

  const monthLabel = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  // Monthly totals
  const monthTotals = useMemo(() => {
    let pnl = 0, fees = 0, tradeCount = 0;
    for (const [dateStr, data] of dailyData) {
      if (dateStr.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)) {
        pnl += data.pnl;
        fees += data.fees;
        tradeCount += data.trades.length;
      }
    }
    return { pnl, fees, tradeCount };
  }, [dailyData, year, month]);

  const selectedData = selectedDay ? dailyData.get(selectedDay) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e1e4e8' }}>
      {/* Top bar */}
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
          PnL Calendar
        </span>
        <span style={{ fontSize: 12, color: '#8a8f98' }}>
          {account.name}
        </span>
      </div>

      {/* Month summary */}
      <div style={{
        display: 'flex', gap: 24, padding: '12px 16px',
        borderBottom: '1px solid #1a1f2e', fontSize: 13,
      }}>
        <span>
          Monthly PnL:{' '}
          <b style={{ color: monthTotals.pnl >= 0 ? '#0ecb81' : '#f6465d' }}>
            ${monthTotals.pnl.toFixed(2)}
          </b>
        </span>
        <span>Fees: <b style={{ color: '#8a8f98' }}>${monthTotals.fees.toFixed(2)}</b></span>
        <span>Trades: <b style={{ color: '#e1e4e8' }}>{monthTotals.tradeCount}</b></span>
      </div>

      {/* Month navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 16, padding: '16px 0',
      }}>
        <button className="btn-secondary" onClick={prevMonth} style={navBtnStyle}>&larr;</button>
        <span style={{ fontSize: 18, fontWeight: 700, minWidth: 200, textAlign: 'center' }}>
          {monthLabel}
        </span>
        <button className="btn-secondary" onClick={nextMonth} style={navBtnStyle}>&rarr;</button>
      </div>

      {/* Calendar grid */}
      <div style={{ maxWidth: 840, margin: '0 auto', padding: '0 16px' }}>
        {/* Weekday headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {WEEKDAYS.map(d => (
            <div key={d} style={{
              textAlign: 'center', fontSize: 11, color: '#8a8f98',
              padding: '4px 0', fontWeight: 600,
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {days.map(({ date, inMonth }, i) => {
            const dateStr = date.toLocaleDateString('en-CA');
            const data = dailyData.get(dateStr);
            const hasTrades = !!data && data.trades.length > 0;
            const pnl = data?.pnl ?? 0;
            const isSelected = selectedDay === dateStr;
            const isToday = dateStr === now.toLocaleDateString('en-CA');

            let bgColor = '#141820';
            if (hasTrades) {
              bgColor = pnl >= 0 ? '#0ecb8118' : '#f6465d18';
            }
            if (isSelected) {
              bgColor = pnl >= 0 ? '#0ecb8130' : '#f6465d30';
            }

            let borderColor = '#1a1f2e';
            if (isSelected) borderColor = pnl >= 0 ? '#0ecb81' : '#f6465d';
            else if (isToday) borderColor = '#3861fb';

            return (
              <div
                key={i}
                onClick={() => hasTrades && setSelectedDay(isSelected ? null : dateStr)}
                style={{
                  padding: '8px 6px',
                  minHeight: 70,
                  background: bgColor,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 0,
                  opacity: inMonth ? 1 : 0.3,
                  cursor: hasTrades ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  fontSize: 11, color: isToday ? '#3861fb' : '#8a8f98',
                  fontWeight: isToday ? 700 : 400,
                }}>
                  {date.getDate()}
                </div>
                {hasTrades && (
                  <>
                    <div style={{
                      fontSize: 14, fontWeight: 700, marginTop: 4,
                      color: pnl >= 0 ? '#0ecb81' : '#f6465d',
                    }}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 10, color: '#8a8f98', marginTop: 2 }}>
                      {data!.trades.length} trade{data!.trades.length !== 1 ? 's' : ''}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Trade detail panel */}
      {selectedData && (
        <div style={{
          maxWidth: 840, margin: '16px auto', padding: '0 16px',
        }}>
          <div style={{
            background: '#141820', border: '1px solid #1a1f2e',
            borderRadius: 0, overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', borderBottom: '1px solid #1a1f2e',
            }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {new Date(selectedData.date + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                })}
              </span>
              <span style={{
                fontWeight: 700, fontSize: 14,
                color: selectedData.pnl >= 0 ? '#0ecb81' : '#f6465d',
              }}>
                PnL: {selectedData.pnl >= 0 ? '+' : ''}${selectedData.pnl.toFixed(2)}
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#8a8f98', fontSize: 11 }}>
                  <th style={{ padding: '6px 16px', textAlign: 'left' }}>Time</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Asset</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Side</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Price</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Size</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Fee</th>
                  <th style={{ textAlign: 'right', padding: '6px 16px' }}>PnL</th>
                </tr>
              </thead>
              <tbody>
                {groupFillsForDay(selectedData.trades).map((item, groupIdx) => {
                  if (item.kind === 'single') {
                    const fill = item.fill;
                    const pnl = parseFloat(fill.realizedPnl);
                    const isOption = isOptionKind(fill.kind);
                    const assetLabel = isOption ? formatContractLabel(fill.coin) : fill.coin;
                    const sideLabel = isOption
                      ? optionSideLabel(fill.kind, fill.side)
                      : fill.side.toUpperCase();
                    const sideColor = isOption
                      ? optionSideColor(fill.kind, fill.side)
                      : fill.side === 'buy' ? '#0ecb81' : '#f6465d';
                    const feeDisplay = isOption ? '-' : `$${parseFloat(fill.fee).toFixed(4)}`;
                    const sizeTitle = isOption
                      ? `${fill.size} contract${fill.size === '1' ? '' : 's'} × 100 shares`
                      : undefined;
                    return (
                      <tr key={fill.id} className="fill-row" style={{
                        borderBottom: '1px solid #1a1f2e',
                      }}>
                        <td style={{ padding: '6px 16px', fontSize: 12, color: '#8a8f98' }}>
                          {new Date(fill.timestamp).toLocaleTimeString()}
                        </td>
                        <td
                          style={{ padding: '6px 8px', fontWeight: 600 }}
                          title={isOption ? fill.coin : undefined}
                        >
                          {assetLabel}
                        </td>
                        <td style={{
                          padding: '6px 8px',
                          color: sideColor,
                          fontWeight: 600,
                        }}>
                          {sideLabel}
                        </td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                          ${parseFloat(fill.price).toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '6px 8px' }} title={sizeTitle}>
                          {fill.size}{isOption ? ' ×100' : ''}
                        </td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: '#8a8f98' }}>
                          {feeDisplay}
                        </td>
                        <td style={{
                          textAlign: 'right', padding: '6px 16px',
                          color: pnl >= 0 ? '#0ecb81' : '#f6465d',
                          fontWeight: 600,
                        }}>
                          {pnl !== 0 ? `$${pnl.toFixed(2)}` : '-'}
                        </td>
                      </tr>
                    );
                  }

                  // Spread group — header row + (if expanded) indented leg rows.
                  const spreadKey = `${selectedData.date}|${item.spreadId}|${item.lifecycle}|${groupIdx}`;
                  const expanded = expandedSpreads.has(spreadKey);
                  const verb = lifecycleVerb(item.lifecycle);
                  const legCount = item.fills.length;
                  const pnl = item.realizedPnl;
                  const showPnl = item.lifecycle !== 'option-open';
                  return (
                    <Fragment key={spreadKey}>
                      <tr
                        className="fill-row"
                        onClick={() => toggleSpread(spreadKey)}
                        style={{
                          borderBottom: '1px solid #1a1f2e',
                          cursor: 'pointer',
                          background: '#1a1f2e40',
                        }}
                        title={expanded ? 'Collapse legs' : 'Expand legs'}
                      >
                        <td style={{ padding: '6px 16px', fontSize: 12, color: '#8a8f98' }}>
                          {new Date(item.firstTimestamp).toLocaleTimeString()}
                        </td>
                        <td colSpan={4} style={{ padding: '6px 8px', fontWeight: 600 }}>
                          <span style={{ color: '#8a8f98', marginRight: 6 }}>
                            {expanded ? '▾' : '▸'}
                          </span>
                          {verb} {item.strategy}
                          <span style={{ color: '#8a8f98', fontWeight: 400, marginLeft: 8 }}>
                            · {legCount} legs · {premiumLabel(item.lifecycle, item.netPremium)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: '#8a8f98' }}>
                          -
                        </td>
                        <td style={{
                          textAlign: 'right', padding: '6px 16px',
                          color: showPnl ? (pnl >= 0 ? '#0ecb81' : '#f6465d') : '#8a8f98',
                          fontWeight: 600,
                        }}>
                          {showPnl && pnl !== 0 ? `$${pnl.toFixed(2)}` : '-'}
                        </td>
                      </tr>
                      {expanded && item.fills.map((fill) => {
                        const lp = parseFloat(fill.realizedPnl);
                        return (
                          <tr key={fill.id} style={{
                            borderBottom: '1px solid #1a1f2e',
                            background: '#0d111740',
                          }}>
                            <td style={{ padding: '6px 16px 6px 32px', fontSize: 12, color: '#5a5f68' }}>
                              ↳
                            </td>
                            <td
                              style={{ padding: '6px 8px', fontWeight: 500, color: '#b0b5bd' }}
                              title={fill.coin}
                            >
                              {formatContractLabel(fill.coin)}
                            </td>
                            <td style={{
                              padding: '6px 8px',
                              color: optionSideColor(fill.kind, fill.side),
                              fontWeight: 600,
                            }}>
                              {optionSideLabel(fill.kind, fill.side)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '6px 8px', color: '#b0b5bd' }}>
                              ${parseFloat(fill.price).toFixed(2)}
                            </td>
                            <td
                              style={{ textAlign: 'right', padding: '6px 8px', color: '#b0b5bd' }}
                              title={`${fill.size} contract${fill.size === '1' ? '' : 's'} × 100 shares`}
                            >
                              {fill.size} ×100
                            </td>
                            <td style={{ textAlign: 'right', padding: '6px 8px', color: '#5a5f68' }}>
                              -
                            </td>
                            <td style={{
                              textAlign: 'right', padding: '6px 16px',
                              color: lp >= 0 ? '#0ecb81' : '#f6465d',
                              fontWeight: 500,
                            }}>
                              {lp !== 0 ? `$${lp.toFixed(2)}` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 16,
  fontWeight: 700,
};

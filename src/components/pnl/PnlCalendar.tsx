import { useState, useMemo } from 'react';
import { usePaperAccountsStore } from '../../store/usePaperAccountsStore.ts';
import type { LedgerEntry } from '../../engine/paper/ledger.ts';

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
        <button onClick={prevMonth} style={navBtnStyle}>&larr;</button>
        <span style={{ fontSize: 18, fontWeight: 700, minWidth: 200, textAlign: 'center' }}>
          {monthLabel}
        </span>
        <button onClick={nextMonth} style={navBtnStyle}>&rarr;</button>
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
                  borderRadius: 6,
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
            borderRadius: 8, overflow: 'hidden',
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
                {selectedData.trades.map((fill, idx) => {
                  const pnl = parseFloat(fill.realizedPnl);
                  return (
                    <tr key={fill.id} style={{
                      borderBottom: '1px solid #1a1f2e',
                      backgroundColor: idx % 2 === 1 ? '#0d1117' : 'transparent',
                    }}>
                      <td style={{ padding: '6px 16px', fontSize: 12, color: '#8a8f98' }}>
                        {new Date(fill.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{fill.coin}</td>
                      <td style={{
                        padding: '6px 8px',
                        color: fill.side === 'buy' ? '#0ecb81' : '#f6465d',
                        fontWeight: 600,
                      }}>
                        {fill.side.toUpperCase()}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                        ${parseFloat(fill.price).toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                        {fill.size}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', color: '#8a8f98' }}>
                        ${parseFloat(fill.fee).toFixed(4)}
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
  background: '#1a1f2e',
  border: '1px solid #2a2f3e',
  borderRadius: 6,
  padding: '6px 14px',
  color: '#e1e4e8',
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 700,
};

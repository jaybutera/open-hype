import { useState, useMemo } from 'react';
import { usePaperAccountsStore } from '../../store/usePaperAccountsStore.ts';
import { buildTradeWindows, attachNotes, type TradeWindow } from '../../services/journal/tradeWindows.ts';
import { JournalChart } from './JournalChart.tsx';

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(start: number, end: number | null): string {
  if (end === null) return 'open';
  const ms = end - start;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function JournalPage() {
  const account = usePaperAccountsStore(s => s.getActiveAccount());
  const editJournalEntry = usePaperAccountsStore(s => s.editJournalEntry);
  const deleteJournalEntry = usePaperAccountsStore(s => s.deleteJournalEntry);

  const fills = account.fills;
  const notes = account.journalEntries ?? [];

  const { windows, looseNotes } = useMemo(() => {
    const ws = buildTradeWindows(fills);
    ws.sort((a, b) => b.entryTime - a.entryTime); // newest first
    return attachNotes(ws, notes);
  }, [fills, notes]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = windows.find(w => w.id === selectedId) ?? null;

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e1e4e8', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        borderBottom: '1px solid #1a1f2e', flexShrink: 0,
      }}>
        <a href="#/" style={{ color: '#3861fb', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
          &larr; Back to Trading
        </a>
        <a href="#/pnl" style={{ color: '#3861fb', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
          PnL
        </a>
        <span style={{ fontWeight: 800, fontSize: 16, color: '#3861fb' }}>Journal</span>
        <span style={{ fontSize: 12, color: '#8a8f98' }}>{account.name}</span>
        <span style={{ fontSize: 12, color: '#8a8f98', marginLeft: 'auto' }}>
          {windows.length} trades · {notes.length} notes
        </span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Trade list */}
        <div style={{
          width: 300, flexShrink: 0, borderRight: '1px solid #1a1f2e',
          overflowY: 'auto',
        }}>
          {windows.length === 0 && (
            <div style={{ padding: 16, color: '#8a8f98', fontSize: 13 }}>
              No trades yet. Place a paper trade and jot notes from the chart.
            </div>
          )}
          {windows.map(w => {
            const isSel = w.id === selectedId;
            const pnlColor = w.realizedPnl >= 0 ? '#0ecb81' : '#f6465d';
            return (
              <div
                key={w.id}
                onClick={() => setSelectedId(w.id)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid #1a1f2e',
                  cursor: 'pointer',
                  background: isSel ? '#1a1f2e' : 'transparent',
                  borderLeft: `3px solid ${isSel ? '#3861fb' : 'transparent'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {w.coin}{' '}
                    <span style={{ color: w.direction === 'long' ? '#0ecb81' : '#f6465d', fontSize: 11 }}>
                      {w.direction.toUpperCase()}
                    </span>
                  </span>
                  <span style={{ color: pnlColor, fontWeight: 700, fontSize: 13 }}>
                    {w.realizedPnl >= 0 ? '+' : ''}{w.realizedPnl.toFixed(2)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#8a8f98', marginTop: 3 }}>
                  {fmtTime(w.entryTime)} · {fmtDuration(w.entryTime, w.exitTime)}
                </div>
                {w.notes.length > 0 && (
                  <div style={{ fontSize: 11, color: '#f0b90b', marginTop: 3 }}>
                    📝 {w.notes.length} note{w.notes.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            );
          })}

          {/* Loose notes (written while flat / no matching trade) */}
          {looseNotes.length > 0 && (
            <div style={{ padding: '12px 14px', borderTop: '2px solid #2a2f3e' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8a8f98', marginBottom: 8 }}>
                LOOSE NOTES ({looseNotes.length})
              </div>
              {looseNotes.map(n => (
                <NoteCard
                  key={n.id}
                  time={n.timestamp}
                  coin={n.coin}
                  text={n.text}
                  onEdit={(text) => editJournalEntry(n.id, text)}
                  onDelete={() => deleteJournalEntry(n.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail: chart + notes */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8f98' }}>
              Select a trade to view it on the chart.
            </div>
          ) : (
            <TradeDetail
              key={selected.id}
              trade={selected}
              onEditNote={editJournalEntry}
              onDeleteNote={deleteJournalEntry}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TradeDetail({
  trade, onEditNote, onDeleteNote,
}: {
  trade: TradeWindow;
  onEditNote: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
}) {
  return (
    <>
      <div style={{ flex: 1, minHeight: 320 }}>
        <JournalChart trade={trade} />
      </div>
      <div style={{
        maxHeight: '40%', overflowY: 'auto', borderTop: '1px solid #1a1f2e',
        padding: '12px 16px',
      }}>
        <div style={{ fontSize: 12, color: '#8a8f98', marginBottom: 10 }}>
          {trade.coin} {trade.direction.toUpperCase()} · entry {fmtTime(trade.entryTime)}
          {trade.exitTime !== null ? ` · exit ${fmtTime(trade.exitTime)}` : ' · still open'}
        </div>
        {trade.notes.length === 0 ? (
          <div style={{ fontSize: 13, color: '#8a8f98' }}>
            No notes during this trade.
          </div>
        ) : (
          trade.notes.map(n => (
            <NoteCard
              key={n.id}
              time={n.timestamp}
              coin={n.coin}
              text={n.text}
              onEdit={(text) => onEditNote(n.id, text)}
              onDelete={() => onDeleteNote(n.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

function NoteCard({
  time, coin, text, onEdit, onDelete,
}: {
  time: number;
  coin?: string;
  text: string;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  return (
    <div style={{
      background: '#141820', border: '1px solid #1a1f2e',
      padding: '8px 10px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#8a8f98' }}>
          {fmtTime(time)}{coin ? ` · ${coin}` : ''}
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          {!editing && (
            <button onClick={() => { setDraft(text); setEditing(true); }} style={iconBtn}>edit</button>
          )}
          <button onClick={onDelete} style={{ ...iconBtn, color: '#f6465d' }}>delete</button>
        </span>
      </div>
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            style={{
              width: '100%', minHeight: 60, background: '#0d1117', color: '#e1e4e8',
              border: '1px solid #2a2f3e', padding: 6, fontSize: 13, fontFamily: 'inherit',
              boxSizing: 'border-box', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              onClick={() => { onEdit(draft); setEditing(false); }}
              style={{ ...iconBtn, color: '#0ecb81' }}
            >
              save
            </button>
            <button onClick={() => setEditing(false)} style={iconBtn}>cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{text}</div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#8a8f98',
  cursor: 'pointer', fontSize: 11, padding: 0,
};

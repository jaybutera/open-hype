import { useState, useEffect, useRef } from 'react';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { usePaperAccountsStore } from '../../store/usePaperAccountsStore.ts';

/**
 * Floating "quick note" button + popover, shown on the trading view. Captures
 * a timestamped note and snapshots the active pane's asset. Association to a
 * trade is derived later (by timestamp) on the journal page — nothing is linked
 * at write time.
 */
export function JournalCapture() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activePane = useMarketStore(s => s.panes[s.activePaneId] ?? s.panes.primary);
  const coin = activePane?.asset ?? 'BTC';
  const addJournalEntry = usePaperAccountsStore(s => s.addJournalEntry);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const save = () => {
    if (!text.trim()) { setOpen(false); return; }
    addJournalEntry(text, coin);
    setText('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setText(''); setOpen(false); }
    // Cmd/Ctrl+Enter to save quickly.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  };

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 300 }}>
      {open && (
        <div style={{
          position: 'absolute', right: 0, bottom: 52, width: 300,
          background: '#141820', border: '1px solid #2a2f3e',
          boxShadow: '0 6px 24px rgba(0,0,0,0.5)', padding: 12,
        }}>
          <div style={{ fontSize: 11, color: '#8a8f98', marginBottom: 6 }}>
            Note · {coin} · now
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What are you thinking?"
            style={{
              width: '100%', minHeight: 90, background: '#0d1117', color: '#e1e4e8',
              border: '1px solid #2a2f3e', padding: 8, fontSize: 13, fontFamily: 'inherit',
              boxSizing: 'border-box', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 10, color: '#5a5f68' }}>⌘/Ctrl+Enter</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setText(''); setOpen(false); }}
                style={{
                  background: 'transparent', border: '1px solid #2a2f3e', color: '#8a8f98',
                  padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                style={{
                  background: '#3861fb', border: '1px solid #3861fb', color: '#fff',
                  padding: '4px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Save
              </button>
            </span>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(v => !v)}
        title="Quick journal note"
        style={{
          width: 44, height: 44, borderRadius: '50%',
          background: open ? '#2a2f3e' : '#3861fb', color: '#fff',
          border: 'none', cursor: 'pointer', fontSize: 20, fontWeight: 700,
          boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {open ? '×' : '✎'}
      </button>
    </div>
  );
}

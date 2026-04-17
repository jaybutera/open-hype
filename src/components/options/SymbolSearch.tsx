import { useEffect, useMemo, useRef, useState } from 'react';
import type { SymbolHit } from '../../services/options/types.ts';
import {
  addRecentSymbol,
  getRecentSymbols,
  searchPopularSymbols,
} from '../../services/options/symbols.ts';

interface Props {
  value: string | null;
  onChange: (symbol: string) => void;
  disabled?: boolean;
}

type Row = SymbolHit & { recent?: boolean };

const DEBOUNCE_MS = 300;

export function SymbolSearch({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [recents, setRecents] = useState<string[]>(() => getRecentSymbols());
  const [activeIdx, setActiveIdx] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const q = debounced.toUpperCase();
    if (!q) {
      return recents.map((s) => ({ symbol: s, recent: true }));
    }
    const hits = searchPopularSymbols(debounced, 12);
    const hasExact = hits.some((h) => h.symbol === q);
    const out: Row[] = hasExact ? hits : [{ symbol: q }, ...hits];
    return out.slice(0, 12);
  }, [debounced, recents]);

  useEffect(() => {
    setActiveIdx(0);
  }, [debounced, open]);

  const commit = (sym: string) => {
    const upper = sym.trim().toUpperCase();
    if (!upper) return;
    setRecents(addRecentSymbol(upper));
    onChange(upper);
    setQuery('');
    setDebounced('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = rows[activeIdx];
      if (picked) commit(picked.symbol);
      else if (query.trim()) commit(query);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const placeholder = value ? value : 'Search symbol (e.g. TSLA, SPY)';

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 320 }}>
      <input
        ref={inputRef}
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="characters"
        autoCorrect="off"
        style={{
          width: '100%',
          padding: '8px 12px',
          background: '#141820',
          border: '1px solid #2a2f3e',
          borderRadius: 0,
          color: '#e1e4e8',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: 0.3,
          outline: 'none',
          opacity: disabled ? 0.5 : 1,
        }}
      />

      {open && !disabled && rows.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            width: '100%',
            background: '#141820',
            border: '1px solid #2a2f3e',
            borderRadius: 0,
            maxHeight: 360,
            overflowY: 'auto',
            zIndex: 200,
          }}
        >
          {!debounced && recents.length > 0 && (
            <div style={{
              padding: '6px 12px',
              fontSize: 10,
              letterSpacing: 0.5,
              color: '#555',
              fontWeight: 700,
              textTransform: 'uppercase',
              borderBottom: '1px solid #1a1f2e',
            }}>
              Recent
            </div>
          )}
          {rows.map((r, i) => (
            <div
              key={`${r.symbol}-${i}`}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(r.symbol);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                background: i === activeIdx ? '#1a1f2e' : 'transparent',
                borderBottom: '1px solid #1a1f2e',
              }}
            >
              <span style={{ fontWeight: 700, color: '#e1e4e8', minWidth: 64 }}>
                {r.symbol}
              </span>
              <span style={{ flex: 1, color: '#8a8f98', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name ?? (r.recent ? 'Recent' : 'Free-form')}
              </span>
              {r.recent && (
                <span style={{ color: '#555', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Recent
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

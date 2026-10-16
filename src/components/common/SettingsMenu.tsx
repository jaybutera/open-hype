import { useState, useRef, useEffect } from 'react';
import { useThemeStore, DEFAULT_UP, DEFAULT_DOWN } from '../../store/useThemeStore.ts';

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, padding: '8px 12px', fontSize: 12, color: '#e1e4e8',
};

const swatchStyle: React.CSSProperties = {
  width: 36, height: 22, padding: 0, border: '1px solid #2a2f3e',
  background: 'transparent', cursor: 'pointer',
};

export function SettingsMenu() {
  const up = useThemeStore(s => s.up);
  const down = useThemeStore(s => s.down);
  const showGrid = useThemeStore(s => s.showGrid);
  const setUp = useThemeStore(s => s.setUp);
  const setDown = useThemeStore(s => s.setDown);
  const setShowGrid = useThemeStore(s => s.setShowGrid);
  const resetColors = useThemeStore(s => s.resetColors);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const isDefault = up === DEFAULT_UP && down === DEFAULT_DOWN;

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        className="btn-secondary"
        onClick={() => setOpen(!open)}
        title="Settings"
        aria-label="Settings"
        style={{ padding: '4px 10px', fontSize: 14, lineHeight: 1 }}
      >
        ⚙
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#141820', border: '1px solid #2a2f3e',
          minWidth: 220, zIndex: 300, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          padding: '4px 0',
        }}>
          <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, color: '#8a8f98', letterSpacing: 0.5 }}>
            CHART
          </div>
          <label style={{ ...rowStyle, cursor: 'pointer' }}>
            Background grid
            <input
              type="checkbox"
              checked={showGrid}
              onChange={e => setShowGrid(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
          </label>

          <div style={{ padding: '10px 12px 6px', fontSize: 10, fontWeight: 700, color: '#8a8f98', letterSpacing: 0.5, borderTop: '1px solid #1a1f2e', marginTop: 4 }}>
            COLORS
          </div>
          <label style={rowStyle}>
            <span style={{ color: 'var(--up)', fontWeight: 600 }}>Up / buy / profit</span>
            <input type="color" value={up} onChange={e => setUp(e.target.value)} style={swatchStyle} />
          </label>
          <label style={rowStyle}>
            <span style={{ color: 'var(--down)', fontWeight: 600 }}>Down / sell / loss</span>
            <input type="color" value={down} onChange={e => setDown(e.target.value)} style={swatchStyle} />
          </label>
          <div style={{ padding: '6px 12px 8px' }}>
            <button
              className="btn-ghost"
              onClick={resetColors}
              disabled={isDefault}
              style={{ padding: '4px 10px', fontSize: 11, width: '100%', opacity: isDefault ? 0.4 : 1 }}
            >
              Reset colors
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

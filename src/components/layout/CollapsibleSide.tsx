import { useState, type ReactNode } from 'react';

const COLLAPSED_KEY = 'hl-right-collapsed';

function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch {}
}

const stripStyle = {
  width: 16,
  flexShrink: 0,
  borderLeft: '1px solid #1a1f2e',
  background: '#0d1117',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 6,
} as const;

const buttonStyle = {
  width: 16,
  height: 28,
  padding: 0,
  background: 'transparent',
  border: 'none',
  color: '#8a8f98',
  cursor: 'pointer',
  fontSize: 10,
  lineHeight: 1,
} as const;

/** Right-hand dock with a thin strip on its left edge that collapses it to that strip; the state is remembered across reloads. Collapsed children stay mounted. */
export function CollapsibleSide({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggle = () => setCollapsed(c => { saveCollapsed(!c); return !c; });

  return (
    <div data-testid="right-panel" data-collapsed={collapsed ? '1' : '0'} style={{ display: 'flex', flexShrink: 0, minHeight: 0 }}>
      <div style={stripStyle}>
        <button
          data-testid="right-collapse-toggle"
          title={collapsed ? 'Show order panel' : 'Hide order panel'}
          aria-label={collapsed ? 'Show order panel' : 'Hide order panel'}
          onClick={toggle}
          style={buttonStyle}
        >
          {collapsed ? '◀' : '▶'}
        </button>
      </div>
      {/* Hidden, not unmounted: the OrderPanel inside runs Execute clicks from the chart. */}
      <div style={{ display: collapsed ? 'none' : 'flex', minHeight: 0 }}>{children}</div>
    </div>
  );
}

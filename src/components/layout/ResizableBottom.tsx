import { useEffect, useRef, useState, type ReactNode } from 'react';

const HEIGHT_KEY = 'hl-bottom-height';
const COLLAPSED_KEY = 'hl-bottom-collapsed';
/** Height of the bar left when the dock is collapsed; holds the expand button. */
const COLLAPSED_HEIGHT = 18;
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 80;
/** Space always left for the header and chart. */
const MIN_CHART = 160;

function loadHeight(): number {
  try {
    const v = parseInt(localStorage.getItem(HEIGHT_KEY) ?? '', 10);
    return Number.isFinite(v) && v >= MIN_HEIGHT ? v : DEFAULT_HEIGHT;
  } catch { return DEFAULT_HEIGHT; }
}

function saveHeight(h: number) {
  try { localStorage.setItem(HEIGHT_KEY, String(Math.round(h))); } catch {}
}

function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch {}
}

const clamp = (h: number) => Math.max(MIN_HEIGHT, Math.min(h, window.innerHeight - MIN_CHART));

const toggleStyle = {
  position: 'absolute', top: 0, right: 8, zIndex: 11,
  height: COLLAPSED_HEIGHT, padding: '0 6px',
  background: 'transparent', border: 'none',
  color: '#8a8f98', cursor: 'pointer', fontSize: 10, lineHeight: 1,
} as const;

/** Bottom dock with a drag handle on its top edge and a collapse toggle; height and collapsed state are remembered across reloads. */
export function ResizableBottom({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState(() => clamp(loadHeight()));
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggle = () => setCollapsed(c => { saveCollapsed(!c); return !c; });
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      setHeight(clamp(drag.current.startH + drag.current.startY - e.clientY));
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setHeight(h => { saveHeight(h); return h; });
    };
    const onResize = () => setHeight(h => clamp(h));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  if (collapsed) {
    return (
      <div
        data-testid="bottom-panel"
        data-collapsed="1"
        style={{ height: COLLAPSED_HEIGHT, flexShrink: 0, position: 'relative', borderTop: '1px solid #1a1f2e', background: '#0d1117' }}
      >
        <button data-testid="bottom-collapse-toggle" title="Show positions panel" aria-label="Show positions panel" onClick={toggle} style={toggleStyle}>▲</button>
      </div>
    );
  }

  return (
    <div data-testid="bottom-panel" data-collapsed="0" style={{ height, flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <button data-testid="bottom-collapse-toggle" title="Hide positions panel" aria-label="Hide positions panel" onClick={toggle} style={toggleStyle}>▼</button>
      <div
        data-testid="bottom-resize-handle"
        title="Drag to resize; double-click to reset"
        onPointerDown={e => {
          e.preventDefault();
          drag.current = { startY: e.clientY, startH: height };
          document.body.style.cursor = 'row-resize';
          document.body.style.userSelect = 'none';
        }}
        onDoubleClick={() => { const h = clamp(DEFAULT_HEIGHT); setHeight(h); saveHeight(h); }}
        style={{
          position: 'absolute', top: -3, left: 0, right: 0, height: 7, zIndex: 10,
          cursor: 'row-resize', touchAction: 'none',
        }}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: '#0d1117' }}>
        {children}
      </div>
    </div>
  );
}

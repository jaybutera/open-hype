import { useEffect, useRef, useState, type ReactNode } from 'react';

const HEIGHT_KEY = 'hl-bottom-height';
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

const clamp = (h: number) => Math.max(MIN_HEIGHT, Math.min(h, window.innerHeight - MIN_CHART));

/** Bottom dock with a drag handle on its top edge; the height is remembered across reloads. */
export function ResizableBottom({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState(() => clamp(loadHeight()));
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

  return (
    <div data-testid="bottom-panel" style={{ height, flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
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
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#0d1117' }}>
        {children}
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';

export type DrawTool = 'none' | 'line' | 'fib';

interface Props {
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  /** Hint under the buttons: what the next click does. */
  hint: string | null;
  /** Count of lines and fibs on this asset; shows Clear when > 0. */
  drawingCount: number;
  onClear: () => void;
  onClose: () => void;
}

const BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 10px',
  fontSize: 12,
  borderRadius: 4,
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
  boxSizing: 'border-box',
};

function toolStyle(active: boolean): CSSProperties {
  return {
    ...BTN,
    background: active ? 'rgba(56, 97, 251, 0.25)' : 'transparent',
    border: active ? '1px solid rgba(56, 97, 251, 0.6)' : '1px solid transparent',
    color: active ? '#e1e4e8' : '#aab0ba',
  };
}

/**
 * Frosted drawing toolbox over the chart's top-left corner. A tool is armed
 * until the drawing is placed (one click for a line, two for a fib) or ESC.
 * Sits beside the chart canvas, not inside it, so its clicks never reach the
 * chart's mouse handlers.
 */
export function DrawToolbox({ tool, setTool, hint, drawingCount, onClear, onClose }: Props) {
  const toggle = (t: DrawTool) => setTool(tool === t ? 'none' : t);
  return (
    <div
      data-testid="draw-toolbox"
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 5,
        minWidth: 150,
        padding: 6,
        borderRadius: 6,
        background: 'rgba(13, 17, 23, 0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(42, 47, 62, 0.9)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 4px' }}>
        <span style={{ fontSize: 10, letterSpacing: 0.5, color: '#8a8f98', textTransform: 'uppercase' }}>Draw</span>
        <button
          onClick={onClose}
          title="Hide toolbox"
          style={{ background: 'transparent', border: 'none', color: '#8a8f98', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      <button onClick={() => toggle('line')} style={toolStyle(tool === 'line')} title="Horizontal line (Ctrl+Click places one without the tool). Drag to move, double-click to label, × to delete.">
        <span style={{ fontFamily: 'monospace', width: 14, textAlign: 'center' }}>─</span> Line
      </button>
      <button onClick={() => toggle('fib')} style={toolStyle(tool === 'fib')} title="Fib retracement: click the two anchor points">
        <span style={{ fontFamily: 'monospace', width: 14, textAlign: 'center' }}>≡</span> Fib
      </button>
      {drawingCount > 0 && (
        <button onClick={onClear} style={{ ...BTN, background: 'transparent', border: '1px solid transparent', color: '#8a8f98' }} title="Remove every line and fib on this asset">
          <span style={{ fontFamily: 'monospace', width: 14, textAlign: 'center' }}>⌫</span> Clear ({drawingCount})
        </button>
      )}
      <div style={{ fontSize: 10, color: hint ? '#e1e4e8' : '#6a6f78', padding: '4px 4px 0', maxWidth: 190, lineHeight: 1.35 }}>
        {hint ?? 'Ctrl+Click: line · Alt+Click a line: alert at its price'}
      </div>
    </div>
  );
}

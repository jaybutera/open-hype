import { useSettingsStore } from '../../store/useSettingsStore.ts';

export function ModeToggle() {
  const mode = useSettingsStore(s => s.mode);
  const setMode = useSettingsStore(s => s.setMode);

  return (
    <div style={{ display: 'flex', gap: 4, background: '#1a1f2e', borderRadius: 6, padding: 2 }}>
      <button
        onClick={() => setMode('paper')}
        style={{
          padding: '6px 16px',
          borderRadius: 4,
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          background: mode === 'paper' ? '#f0b90b' : 'transparent',
          color: mode === 'paper' ? '#0a0e17' : '#8a8f98',
        }}
      >
        Paper
      </button>
      <button
        onClick={() => setMode('live')}
        style={{
          padding: '6px 16px',
          borderRadius: 4,
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          background: mode === 'live' ? '#e74c3c' : 'transparent',
          color: mode === 'live' ? '#fff' : '#8a8f98',
        }}
      >
        Live
      </button>
    </div>
  );
}

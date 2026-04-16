import { useSettingsStore } from '../../store/useSettingsStore.ts';

export function ModeToggle() {
  const mode = useSettingsStore(s => s.mode);
  const setMode = useSettingsStore(s => s.setMode);

  return (
    <div style={{ display: 'flex', gap: 0 }}>
      <button
        className={mode === 'paper' ? 'btn-mode-paper' : 'btn-toggle'}
        onClick={() => setMode('paper')}
        style={{ padding: '6px 16px', fontSize: 13 }}
      >
        Paper
      </button>
      <button
        className={mode === 'live' ? 'btn-mode-live' : 'btn-toggle'}
        onClick={() => setMode('live')}
        style={{ padding: '6px 16px', fontSize: 13 }}
      >
        Live
      </button>
    </div>
  );
}

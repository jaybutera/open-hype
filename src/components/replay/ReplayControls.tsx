import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useReplayStore, REPLAY_SPEEDS } from '../../store/useReplayStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { getNyOffset } from '../chart/TradingChart.tsx';

const AMBER = '#f0b90b';

/** Format a UTC ms timestamp as New York time (matches the chart axis). */
function fmtNy(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));
}

/** datetime-local value (interpreted as NY wall time) -> UTC ms. */
function nyInputToUtc(value: string): number | null {
  const naive = Date.parse(value + ':00Z');
  if (!Number.isFinite(naive)) return null;
  return naive - getNyOffset(naive / 1000) * 1000;
}

/** UTC ms -> datetime-local value in NY wall time. */
function utcToNyInput(ms: number): string {
  const shifted = new Date(ms + getNyOffset(ms / 1000) * 1000);
  return shifted.toISOString().slice(0, 16);
}

const btnStyle: CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#e1e4e8',
  background: '#1a1f2e', border: '1px solid #2a2f3e',
  padding: '4px 12px', cursor: 'pointer', borderRadius: 0, flexShrink: 0,
};

export function ReplayControls() {
  const active = useReplayStore(s => s.active);
  const showSetup = useReplayStore(s => s.showSetup);
  const assets = useReplayStore(s => s.assets);
  const assetsError = useReplayStore(s => s.assetsError);
  const cursor = useReplayStore(s => s.cursor);
  const playing = useReplayStore(s => s.playing);
  const speed = useReplayStore(s => s.speed);
  const buffering = useReplayStore(s => s.buffering);
  const atEnd = useReplayStore(s => s.atEnd);
  const loadAssets = useReplayStore(s => s.loadAssets);
  const setShowSetup = useReplayStore(s => s.setShowSetup);
  const enterReplay = useReplayStore(s => s.enterReplay);
  const exitReplay = useReplayStore(s => s.exitReplay);
  const stepForward = useReplayStore(s => s.stepForward);
  const togglePlay = useReplayStore(s => s.togglePlay);
  const setSpeed = useReplayStore(s => s.setSpeed);

  const activeAsset = useMarketStore(s => (s.panes[s.activePaneId] ?? s.panes.primary)?.asset ?? 'BTC');
  const activeInterval = useMarketStore(s => (s.panes[s.activePaneId] ?? s.panes.primary)?.interval ?? '5m');

  const [pickerValue, setPickerValue] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (showSetup && assets.length === 0) void loadAssets();
  }, [showSetup, assets.length, loadAssets]);

  // Coverage for the active pane's asset, falling back to the union of all.
  const bounds = useMemo(() => {
    if (assets.length === 0) return null;
    const forAsset = assets.find(a => a.coin === activeAsset);
    if (forAsset) return { min: forAsset.firstTs, max: forAsset.lastTs };
    return {
      min: Math.min(...assets.map(a => a.firstTs)),
      max: Math.max(...assets.map(a => a.lastTs)),
    };
  }, [assets, activeAsset]);

  // Default the picker to 24h before the end of the recording.
  useEffect(() => {
    if (bounds && !pickerValue) {
      setPickerValue(utcToNyInput(Math.max(bounds.min, bounds.max - 86_400_000)));
    }
  }, [bounds, pickerValue]);

  if (!active && !showSetup) return null;

  const barStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '6px 16px', background: '#0d1117',
    borderBottom: `1px solid ${active ? AMBER : '#1a1f2e'}`,
  };

  if (!active) {
    const hasData = assets.some(a => a.coin === activeAsset);
    const start = pickerValue ? nyInputToUtc(pickerValue) : null;
    const valid = start !== null && bounds !== null
      && start >= bounds.min && start <= bounds.max;
    return (
      <div style={barStyle}>
        <span style={{ fontSize: 12, fontWeight: 700, color: AMBER, flexShrink: 0 }}>REPLAY SETUP</span>
        {assetsError ? (
          <span style={{ fontSize: 12, color: '#f6465d' }}>
            No local candle data available ({assetsError})
          </span>
        ) : bounds === null ? (
          <span style={{ fontSize: 12, color: '#8a8f98' }}>Loading recorded data…</span>
        ) : (
          <>
            <span style={{ fontSize: 12, color: '#8a8f98' }}>Start at (NY time):</span>
            <input
              type="datetime-local"
              value={pickerValue}
              min={utcToNyInput(bounds.min)}
              max={utcToNyInput(bounds.max)}
              onChange={e => setPickerValue(e.target.value)}
              style={{
                fontSize: 12, color: '#e1e4e8', background: '#1a1f2e',
                border: '1px solid #2a2f3e', padding: '3px 8px', colorScheme: 'dark',
              }}
            />
            <span style={{ fontSize: 11, color: '#555' }}>
              {hasData
                ? `${activeAsset}: ${fmtNy(bounds.min)} → ${fmtNy(bounds.max)}`
                : `no recording for ${activeAsset} — recorded: ${assets.map(a => a.coin).join(', ')}`}
            </span>
            <button
              disabled={!valid || starting}
              onClick={async () => {
                if (start === null) return;
                setStarting(true);
                try { await enterReplay(start); } finally { setStarting(false); }
              }}
              style={{
                ...btnStyle,
                background: valid ? AMBER : '#1a1f2e',
                color: valid ? '#0d1117' : '#555',
                border: `1px solid ${valid ? AMBER : '#2a2f3e'}`,
                cursor: valid ? 'pointer' : 'default',
              }}
            >
              {starting ? 'Loading…' : 'Start Replay'}
            </button>
          </>
        )}
        <button onClick={() => setShowSetup(false)} style={{ ...btnStyle, marginLeft: 'auto' }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div style={barStyle}>
      <span style={{ fontSize: 12, fontWeight: 700, color: AMBER, flexShrink: 0 }}>● REPLAY</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#e1e4e8', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {fmtNy(cursor)} NY
      </span>

      <button onClick={() => void stepForward()} style={btnStyle} title={`Advance one ${activeInterval} candle`}>
        +1 {activeInterval} ▸
      </button>

      <button
        onClick={togglePlay}
        style={{
          ...btnStyle,
          background: playing ? AMBER : '#1a1f2e',
          color: playing ? '#0d1117' : '#e1e4e8',
          border: `1px solid ${playing ? AMBER : '#2a2f3e'}`,
          minWidth: 70,
        }}
      >
        {playing ? '⏸ Pause' : '▶ Play'}
      </button>

      <select
        value={speed}
        onChange={e => setSpeed(Number(e.target.value))}
        title="Playback speed (1m candles per second)"
        style={{
          fontSize: 12, color: '#e1e4e8', background: '#1a1f2e',
          border: '1px solid #2a2f3e', padding: '4px 6px',
        }}
      >
        {REPLAY_SPEEDS.map(s => (
          <option key={s} value={s}>{s}×</option>
        ))}
      </select>

      {buffering && <span style={{ fontSize: 11, color: '#8a8f98' }}>buffering…</span>}
      {atEnd && <span style={{ fontSize: 11, color: '#f6465d', fontWeight: 600 }}>end of recording</span>}

      <button
        onClick={exitReplay}
        style={{ ...btnStyle, marginLeft: 'auto', color: '#f6465d', border: '1px solid #f6465d' }}
      >
        End Replay
      </button>
    </div>
  );
}

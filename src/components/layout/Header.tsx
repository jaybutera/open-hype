import { AssetSelector } from '../common/AssetSelector.tsx';
import { ModeToggle } from '../common/ModeToggle.tsx';
import { PaperAccountSelector } from '../common/PaperAccountSelector.tsx';
import { WalletConnect } from '../account/WalletConnect.tsx';
import { NetworkToggle } from '../common/NetworkToggle.tsx';
import { useLiveAccountStore } from '../../store/useLiveAccountStore.ts';
import { useWalletStore } from '../../store/useWalletStore.ts';
import { Logo } from './Logo.tsx';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useReplayStore } from '../../store/useReplayStore.ts';

export function Header() {
  const mode = useSettingsStore(s => s.mode);
  const favorites = useSettingsStore(s => s.favorites);
  const paperBalance = useAccountStore(s => s.paperBalance);
  const liveAddress = useWalletStore(s => s.address);
  const liveValue = useLiveAccountStore(s => s.accountValue);
  const liveWithdrawable = useLiveAccountStore(s => s.withdrawable);
  const liveSyncError = useLiveAccountStore(s => s.syncError);
  const activePane = useMarketStore(s => s.panes[s.activePaneId] ?? s.panes.primary);
  const currentAsset = activePane?.asset ?? 'BTC';
  const splitView = useMarketStore(s => s.splitView);
  const toggleSplitView = useMarketStore(s => s.toggleSplitView);
  const allMids = useMarketStore(s => s.allMids);
  const setAsset = useMarketStore(s => s.setAsset);
  const loadCandles = useMarketStore(s => s.loadCandles);
  const replayActive = useReplayStore(s => s.active);
  const replaySetup = useReplayStore(s => s.showSetup);
  const setShowSetup = useReplayStore(s => s.setShowSetup);
  const exitReplay = useReplayStore(s => s.exitReplay);

  const handleFavClick = (coin: string) => {
    setAsset(coin);
    loadCandles();
  };

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 16px',
      background: '#0d1117',
      borderBottom: '1px solid #1a1f2e',
      position: 'relative',
      zIndex: 200,
    }}>
      <Logo height={22} />

      <a
        href="#/pnl"
        style={{
          fontSize: 12, fontWeight: 600, color: '#8a8f98',
          textDecoration: 'none', padding: '4px 10px',
          background: 'transparent', border: '1px solid #2a2f3e',
          borderRadius: 0, flexShrink: 0,
        }}
      >
        PnL
      </a>

      <a
        href="#/options"
        style={{
          fontSize: 12, fontWeight: 600, color: '#8a8f98',
          textDecoration: 'none', padding: '4px 10px',
          background: 'transparent', border: '1px solid #2a2f3e',
          borderRadius: 0, flexShrink: 0,
        }}
      >
        Options
      </a>

      <a
        href="#/journal"
        style={{
          fontSize: 12, fontWeight: 600, color: '#8a8f98',
          textDecoration: 'none', padding: '4px 10px',
          background: 'transparent', border: '1px solid #2a2f3e',
          borderRadius: 0, flexShrink: 0,
        }}
      >
        Journal
      </a>

      <button
        onClick={toggleSplitView}
        style={{
          fontSize: 12, fontWeight: 700,
          color: splitView ? '#fff' : '#e1e4e8',
          background: splitView ? '#3861fb' : '#1a1f2e',
          padding: '4px 12px', cursor: 'pointer',
          border: `1px solid ${splitView ? '#3861fb' : '#2a2f3e'}`,
          borderRadius: 0, flexShrink: 0,
        }}
        title="Toggle split chart view"
      >
        {splitView ? 'Split: ON' : 'Split'}
      </button>

      <button
        onClick={() => replayActive ? exitReplay() : setShowSetup(!replaySetup)}
        style={{
          fontSize: 12, fontWeight: 700,
          color: replayActive ? '#0d1117' : '#e1e4e8',
          background: replayActive ? '#f0b90b' : '#1a1f2e',
          padding: '4px 12px', cursor: 'pointer',
          border: `1px solid ${replayActive || replaySetup ? '#f0b90b' : '#2a2f3e'}`,
          borderRadius: 0, flexShrink: 0,
        }}
        title={replayActive ? 'End replay' : 'Replay recorded history'}
      >
        {replayActive ? 'Replay: ON' : 'Replay'}
      </button>

      <AssetSelector />

      {/* Favorite chips */}
      {favorites.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {favorites.map(coin => {
            const mid = allMids[coin];
            const isActive = coin === currentAsset;
            const shortName = coin.startsWith('xyz:') ? coin.slice(4) : coin;
            return (
              <button
                key={coin}
                className={`btn-chip${isActive ? ' active' : ''}`}
                onClick={() => handleFavClick(coin)}
                style={{ padding: '4px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {shortName}
                {mid && (
                  <span style={{ marginLeft: 6, fontWeight: 400, color: '#555' }}>
                    {parseFloat(mid).toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <ModeToggle />

      {mode === 'paper' && (
        <>
          <PaperAccountSelector />
          <span style={{ fontSize: 13, color: '#f0b90b', fontWeight: 600, flexShrink: 0 }}>
            PAPER ${parseFloat(paperBalance).toFixed(2)}
          </span>
        </>
      )}

      {mode === 'live' && (
        <>
          <NetworkToggle />
          {liveAddress && (
            <span
              data-testid="live-balance"
              title={liveSyncError ? `Sync error: ${liveSyncError}` : `Withdrawable $${liveWithdrawable.toFixed(2)}`}
              style={{ fontSize: 13, color: liveSyncError ? '#f6465d' : '#0ecb81', fontWeight: 600, flexShrink: 0 }}
            >
              LIVE ${liveValue.toFixed(2)}
            </span>
          )}
        </>
      )}

      <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
        <WalletConnect />
      </div>
    </header>
  );
}

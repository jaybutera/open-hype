import { AssetSelector } from '../common/AssetSelector.tsx';
import { ModeToggle } from '../common/ModeToggle.tsx';
import { PaperAccountSelector } from '../common/PaperAccountSelector.tsx';
import { WalletInput } from '../account/WalletInput.tsx';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';

export function Header() {
  const mode = useSettingsStore(s => s.mode);
  const favorites = useSettingsStore(s => s.favorites);
  const paperBalance = useAccountStore(s => s.paperBalance);
  const activePane = useMarketStore(s => s.panes[s.activePaneId] ?? s.panes.primary);
  const currentAsset = activePane?.asset ?? 'BTC';
  const splitView = useMarketStore(s => s.splitView);
  const toggleSplitView = useMarketStore(s => s.toggleSplitView);
  const allMids = useMarketStore(s => s.allMids);
  const setAsset = useMarketStore(s => s.setAsset);
  const loadCandles = useMarketStore(s => s.loadCandles);

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
      <span style={{ fontWeight: 800, fontSize: 16, color: '#3861fb', flexShrink: 0 }}>
        Open Hype
      </span>

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

      <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
        <WalletInput />
      </div>
    </header>
  );
}

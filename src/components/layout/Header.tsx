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
  const currentAsset = useMarketStore(s => s.currentAsset);
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
        HL Trade
      </span>

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
                onClick={() => handleFavClick(coin)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: isActive ? '#2a2f3e' : '#141820',
                  border: isActive ? '1px solid #3861fb' : '1px solid #1a1f2e',
                  borderRadius: 4,
                  color: isActive ? '#e1e4e8' : '#8a8f98',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
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

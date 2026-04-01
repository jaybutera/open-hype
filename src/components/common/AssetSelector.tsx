import { useState, useRef, useEffect, useMemo } from 'react';
import { useMarketStore, type AssetCategory, type CategorizedAsset } from '../../store/useMarketStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';

export function AssetSelector() {
  const currentAsset = useMarketStore(s => s.currentAsset);
  const allMids = useMarketStore(s => s.allMids);
  const setAsset = useMarketStore(s => s.setAsset);
  const loadCandles = useMarketStore(s => s.loadCandles);
  const meta = useMarketStore(s => s.meta);
  const xyzMeta = useMarketStore(s => s.xyzMeta);
  const favorites = useSettingsStore(s => s.favorites);
  const toggleFavorite = useSettingsStore(s => s.toggleFavorite);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<AssetCategory | 'favorites'>('perps');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const assets = useMemo<CategorizedAsset[]>(() => {
    const perps: CategorizedAsset[] = (meta?.universe ?? [])
      .filter(a => !(a as any).isDelisted)
      .map(a => ({ ...a, category: 'perps' as const }));
    const xyz: CategorizedAsset[] = (xyzMeta?.universe ?? [])
      .filter(a => !(a as any).isDelisted)
      .map(a => ({ ...a, category: 'xyz' as const }));
    return [...perps, ...xyz];
  }, [meta, xyzMeta]);

  const filtered = useMemo(() => {
    if (search) {
      const q = search.toLowerCase();
      return assets.filter(a => a.name.toLowerCase().includes(q));
    }
    if (tab === 'favorites') return assets.filter(a => favorites.includes(a.name));
    return assets.filter(a => a.category === tab);
  }, [assets, search, tab, favorites]);

  const handleSelect = (name: string) => {
    setAsset(name);
    setOpen(false);
    setSearch('');
    loadCandles();
  };

  const mid = allMids[currentAsset];
  const isXyz = currentAsset.startsWith('xyz:');
  const displayName = isXyz ? currentAsset : `${currentAsset}-PERP`;

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600 as const,
    background: active ? '#2a2f3e' : 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #3861fb' : '2px solid transparent',
    color: active ? '#e1e4e8' : '#8a8f98',
    cursor: 'pointer' as const,
  });

  return (
    <div style={{ position: 'relative', zIndex: 200 }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        style={{
          background: '#1a1f2e',
          border: '1px solid #2a2f3e',
          borderRadius: 6,
          padding: '8px 16px',
          color: '#e1e4e8',
          cursor: 'pointer',
          fontSize: 15,
          fontWeight: 700,
          minWidth: 160,
          textAlign: 'left',
        }}
      >
        {displayName}
        {mid && (
          <span style={{ marginLeft: 12, color: '#8a8f98', fontWeight: 400, fontSize: 13 }}>
            ${parseFloat(mid).toLocaleString()}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#141820',
            border: '1px solid #2a2f3e',
            borderRadius: 8,
            width: 340,
            maxHeight: 460,
            overflow: 'hidden',
            zIndex: 100,
          }}
        >
          {/* Category tabs — always visible */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #2a2f3e',
            background: '#0d1117',
          }}>
            <button style={tabStyle(tab === 'favorites')} onClick={() => { setTab('favorites'); setSearch(''); }}>
              Favorites
            </button>
            <button style={tabStyle(tab === 'perps')} onClick={() => { setTab('perps'); setSearch(''); }}>
              Perps
            </button>
            <button style={tabStyle(tab === 'xyz')} onClick={() => { setTab('xyz'); setSearch(''); }}>
              XYZ
            </button>
          </div>

          {/* Search */}
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search assets..."
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#1a1f2e',
              border: 'none',
              borderBottom: '1px solid #2a2f3e',
              color: '#e1e4e8',
              fontSize: 14,
              outline: 'none',
            }}
          />

          {/* Asset list */}
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '20px 12px', color: '#555', textAlign: 'center', fontSize: 13 }}>
                {tab === 'favorites' && !search ? 'No favorites yet — star assets to add them' : 'No results'}
              </div>
            )}
            {filtered.map(a => {
              const isFav = favorites.includes(a.name);
              const assetMid = allMids[a.name];
              return (
                <div
                  key={a.name}
                  onClick={() => handleSelect(a.name)}
                  style={{
                    padding: '7px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: a.name === currentAsset ? '#1a1f2e' : 'transparent',
                    fontSize: 13,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1a1f2e')}
                  onMouseLeave={e => (e.currentTarget.style.background = a.name === currentAsset ? '#1a1f2e' : 'transparent')}
                >
                  {/* Favorite star */}
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(a.name); }}
                    style={{
                      cursor: 'pointer',
                      color: isFav ? '#f0b90b' : '#333',
                      fontSize: 14,
                      userSelect: 'none',
                    }}
                  >
                    {isFav ? '\u2605' : '\u2606'}
                  </span>

                  {/* Name */}
                  <span style={{ fontWeight: 600, flex: 1 }}>
                    {a.name}
                    <span style={{ fontWeight: 400, color: '#555', marginLeft: 6, fontSize: 11 }}>
                      {a.maxLeverage}x
                    </span>
                  </span>

                  {/* Price */}
                  <span style={{ color: '#8a8f98', fontSize: 12 }}>
                    {assetMid ? `$${parseFloat(assetMid).toLocaleString()}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

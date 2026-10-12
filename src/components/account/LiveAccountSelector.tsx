import { useState, useRef, useEffect } from 'react';
import { useWalletStore } from '../../store/useWalletStore.ts';

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const usd = (v: number | null) => (v == null ? '' : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Switch between the master account and its Hyperliquid sub-accounts. */
export function LiveAccountSelector() {
  const address = useWalletStore(s => s.address);
  const subAccounts = useWalletStore(s => s.subAccounts);
  const subAccount = useWalletStore(s => s.subAccount);
  const masterValue = useWalletStore(s => s.masterValue);
  const selectAccount = useWalletStore(s => s.selectAccount);
  const loadSubAccounts = useWalletStore(s => s.loadSubAccounts);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!address || subAccounts.length === 0) return null;

  const active = subAccounts.find(a => a.address === subAccount);
  const rows = [
    { address: null as string | null, name: 'Master Account', shown: address, value: masterValue },
    ...subAccounts.map(a => ({ address: a.address as string | null, name: a.name, shown: a.address, value: a.accountValue })),
  ];

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        data-testid="live-account-selector"
        className="btn-secondary"
        onClick={() => { if (!open) void loadSubAccounts(); setOpen(!open); }}
        style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {active ? active.name : 'Master Account'}
        <span style={{ fontSize: 10, color: '#8a8f98' }}>▼</span>
      </button>

      {open && (
        <div role="listbox" style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#141820', border: '1px solid #2a2f3e', borderRadius: 0,
          minWidth: 260, zIndex: 300, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: 4,
        }}>
          {rows.map(r => {
            const selected = (r.address ?? null) === (subAccount ?? null);
            return (
              <div
                key={r.shown}
                role="option"
                aria-selected={selected}
                onClick={() => { selectAccount(r.address); setOpen(false); }}
                style={{ padding: '8px 10px', cursor: 'pointer', background: selected ? '#1a1f2e' : 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e1e4e8' }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: '#8a8f98' }}>{usd(r.value)}</span>
                </div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{short(r.shown)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

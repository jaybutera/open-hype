import { useState, useRef, useEffect } from 'react';
import { usePaperAccountsStore } from '../../store/usePaperAccountsStore.ts';
import { exportAccountTrades } from '../../engine/paper/persistence.ts';

export function PaperAccountSelector() {
  const accounts = usePaperAccountsStore(s => s.accounts);
  const activeAccountId = usePaperAccountsStore(s => s.activeAccountId);
  const setActiveAccount = usePaperAccountsStore(s => s.setActiveAccount);
  const createAccount = usePaperAccountsStore(s => s.createAccount);
  const deleteAccount = usePaperAccountsStore(s => s.deleteAccount);
  const getActiveAccount = usePaperAccountsStore(s => s.getActiveAccount);

  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBalance, setNewBalance] = useState('10000');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowNew(false);
        setConfirmDelete(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const activeAccount = accounts.find(a => a.id === activeAccountId) ?? accounts[0];

  const handleCreate = () => {
    const name = newName.trim() || `Account ${accounts.length + 1}`;
    const bal = parseFloat(newBalance) > 0 ? newBalance : '10000';
    createAccount(name, bal);
    setNewName('');
    setNewBalance('10000');
    setShowNew(false);
    setOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirmDelete === id) {
      deleteAccount(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
    }
  };

  const handleExport = () => {
    const acct = getActiveAccount();
    const json = exportAccountTrades(acct);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paper-trades-${acct.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '5px 12px',
          fontSize: 12,
          fontWeight: 600,
          background: '#1a1f2e',
          border: '1px solid #2a2f3e',
          borderRadius: 4,
          color: '#e1e4e8',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {activeAccount.name}
        <span style={{ fontSize: 10, color: '#8a8f98' }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          background: '#141820',
          border: '1px solid #2a2f3e',
          borderRadius: 6,
          minWidth: 240,
          zIndex: 300,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {/* Account list */}
          <div style={{ padding: 4 }}>
            {accounts.map(acct => (
              <div
                key={acct.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: 4,
                  background: acct.id === activeAccountId ? '#1a1f2e' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div
                  onClick={() => { setActiveAccount(acct.id); setOpen(false); }}
                  style={{ flex: 1 }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e1e4e8' }}>
                    {acct.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#8a8f98', marginTop: 2 }}>
                    ${parseFloat(acct.balance).toFixed(2)} · {acct.fills.length} trades
                  </div>
                </div>
                {accounts.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(acct.id); }}
                    style={{
                      padding: '2px 8px',
                      fontSize: 11,
                      background: confirmDelete === acct.id ? '#e74c3c' : 'transparent',
                      border: confirmDelete === acct.id ? 'none' : '1px solid #333',
                      borderRadius: 3,
                      color: confirmDelete === acct.id ? '#fff' : '#8a8f98',
                      cursor: 'pointer',
                      marginLeft: 8,
                      flexShrink: 0,
                    }}
                  >
                    {confirmDelete === acct.id ? 'Confirm' : 'Del'}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid #1a1f2e', padding: 4 }}>
            {/* Export button */}
            <button
              onClick={handleExport}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 12,
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                color: '#8a8f98',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              Export trades (JSON)
            </button>
          </div>

          <div style={{ borderTop: '1px solid #1a1f2e', padding: 4 }}>
            {!showNew ? (
              <button
                onClick={() => setShowNew(true)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  color: '#3861fb',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                + New Account
              </button>
            ) : (
              <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  placeholder="Account name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  autoFocus
                  style={{
                    padding: '6px 8px',
                    fontSize: 12,
                    background: '#0d1117',
                    border: '1px solid #2a2f3e',
                    borderRadius: 4,
                    color: '#e1e4e8',
                    outline: 'none',
                  }}
                />
                <input
                  placeholder="Initial balance"
                  value={newBalance}
                  onChange={e => setNewBalance(e.target.value)}
                  type="number"
                  style={{
                    padding: '6px 8px',
                    fontSize: 12,
                    background: '#0d1117',
                    border: '1px solid #2a2f3e',
                    borderRadius: 4,
                    color: '#e1e4e8',
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={handleCreate}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      fontSize: 12,
                      fontWeight: 600,
                      background: '#3861fb',
                      border: 'none',
                      borderRadius: 4,
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    Create
                  </button>
                  <button
                    onClick={() => { setShowNew(false); setNewName(''); setNewBalance('10000'); }}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      background: '#1a1f2e',
                      border: 'none',
                      borderRadius: 4,
                      color: '#8a8f98',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useWalletStore } from '../../store/useWalletStore.ts';
import { listWallets, requestWalletAnnouncements, type WalletOption } from '../../services/wallet/eip1193.ts';
import { NETWORK } from '../../services/hl/network.ts';

const inputStyle = {
  padding: '6px 10px', fontSize: 12, background: '#1a1f2e',
  border: '1px solid #2a2f3e', borderRadius: 0, color: '#e1e4e8', outline: 'none', width: '100%',
} as const;

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

function ErrorLine() {
  const error = useWalletStore(s => s.error);
  const clearError = useWalletStore(s => s.clearError);
  if (!error) return null;
  return (
    <div role="alert" data-testid="wallet-error" style={{
      position: 'absolute', right: 0, top: '100%', marginTop: 6, maxWidth: 360,
      background: '#2a1215', border: '1px solid #f6465d', color: '#f6465d',
      fontSize: 11, padding: '6px 8px', display: 'flex', gap: 8, zIndex: 300,
    }}>
      <span style={{ flex: 1 }}>{error}</span>
      <button onClick={clearError} aria-label="Dismiss" style={{ background: 'none', border: 0, color: '#f6465d', cursor: 'pointer' }}>×</button>
    </div>
  );
}

function ConnectMenu({ onClose }: { onClose: () => void }) {
  const connectBrowser = useWalletStore(s => s.connectBrowser);
  const connectApiKey = useWalletStore(s => s.connectApiKey);
  const [wallets, setWallets] = useState<WalletOption[]>(() => listWallets());
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState('');
  const [master, setMaster] = useState('');

  useEffect(() => {
    requestWalletAnnouncements();
    const t = setTimeout(() => setWallets(listWallets()), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div data-testid="connect-menu" style={{
      position: 'absolute', right: 0, top: '100%', marginTop: 6, width: 300,
      background: '#0d1117', border: '1px solid #2a2f3e', padding: 12, zIndex: 300,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {wallets.length === 0 && (
        <div style={{ fontSize: 12, color: '#8a8f98' }}>
          No browser wallet detected. Install MetaMask, Rabby or another EVM wallet, or use an API wallet key below.
        </div>
      )}
      {wallets.map(w => (
        <button
          key={w.id}
          className="btn-secondary"
          onClick={() => { onClose(); void connectBrowser(w.id); }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 13, justifyContent: 'flex-start' }}
        >
          {w.icon && <img src={w.icon} alt="" width={18} height={18} />}
          {w.name}
        </button>
      ))}

      <button
        onClick={() => setShowKey(!showKey)}
        style={{ background: 'none', border: 0, color: '#8a8f98', fontSize: 11, cursor: 'pointer', textAlign: 'left', padding: 0 }}
      >
        {showKey ? '▾' : '▸'} Use an API wallet key
      </button>
      {showKey && (
        <form
          onSubmit={e => { e.preventDefault(); connectApiKey(key, master || undefined); setKey(''); if (useWalletStore.getState().status === 'connected') onClose(); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <div style={{ fontSize: 11, color: '#8a8f98', lineHeight: 1.4 }}>
            Create one at app.hyperliquid.xyz/API. API wallets can trade but cannot withdraw.
            The key stays in this tab's memory and is dropped on reload. Never paste a seed phrase.
          </div>
          <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="API wallet private key" style={inputStyle} />
          <input value={master} onChange={e => setMaster(e.target.value)} placeholder="Account address (0x..., the funded account)" style={inputStyle} />
          <button type="submit" className="btn-primary" style={{ padding: '6px 14px', fontSize: 12 }}>Connect with key</button>
        </form>
      )}
    </div>
  );
}

export function WalletConnect() {
  const status = useWalletStore(s => s.status);
  const address = useWalletStore(s => s.address);
  const source = useWalletStore(s => s.source);
  const walletName = useWalletStore(s => s.walletName);
  const tradingStatus = useWalletStore(s => s.tradingStatus);
  const enableTrading = useWalletStore(s => s.enableTrading);
  const disconnect = useWalletStore(s => s.disconnect);
  const [open, setOpen] = useState(false);

  const netBadge = (
    <span data-testid="network-badge" style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px',
      color: NETWORK === 'mainnet' ? '#f6465d' : '#f0b90b',
      border: `1px solid ${NETWORK === 'mainnet' ? '#f6465d' : '#f0b90b'}`,
    }}>
      {NETWORK.toUpperCase()}
    </span>
  );

  if (status !== 'connected' || !address) {
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
        {netBadge}
        <button
          className="btn-primary"
          disabled={status === 'connecting'}
          onClick={() => setOpen(!open)}
          style={{ padding: '6px 14px', fontSize: 12 }}
        >
          {status === 'connecting' ? 'Check your wallet…' : 'Connect wallet'}
        </button>
        {open && <ConnectMenu onClose={() => setOpen(false)} />}
        <ErrorLine />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
      {netBadge}
      <span data-testid="wallet-address" title={`${address} via ${walletName ?? source}`} style={{ fontSize: 12, color: '#8a8f98' }}>
        {short(address)}
      </span>
      {source === 'browser' && tradingStatus === 'none' && (
        <button
          className="btn-primary"
          onClick={() => void enableTrading()}
          title="Sign one message in your wallet to authorise a trading key for this browser. The key can place and cancel orders but cannot withdraw or transfer funds."
          style={{ padding: '4px 10px', fontSize: 11 }}
        >
          Enable trading
        </button>
      )}
      {tradingStatus === 'approving' && <span style={{ fontSize: 11, color: '#f0b90b' }}>Approve in wallet…</span>}
      {tradingStatus === 'ready' && <span data-testid="trading-ready" style={{ fontSize: 11, color: '#0ecb81' }}>Trading enabled</span>}
      <button className="btn-secondary" onClick={disconnect} style={{ padding: '4px 10px', fontSize: 11 }}>
        Disconnect
      </button>
      <ErrorLine />
    </div>
  );
}

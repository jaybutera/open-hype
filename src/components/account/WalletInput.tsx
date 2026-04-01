import { useState } from 'react';
import { useWalletStore } from '../../store/useWalletStore.ts';

export function WalletInput() {
  const { address, connect, disconnect } = useWalletStore();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);

  if (address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#8a8f98' }}>
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <button
          onClick={disconnect}
          style={{
            padding: '4px 10px', fontSize: 11, background: '#2a2f3e',
            border: 'none', borderRadius: 4, color: '#e1e4e8', cursor: 'pointer',
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type={show ? 'text' : 'password'}
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder="Private key (0x...)"
        style={{
          padding: '6px 10px', fontSize: 12, background: '#1a1f2e',
          border: '1px solid #2a2f3e', borderRadius: 4, color: '#e1e4e8',
          width: 200, outline: 'none',
        }}
      />
      <button
        onClick={() => setShow(!show)}
        style={{
          padding: '4px 8px', fontSize: 11, background: '#2a2f3e',
          border: 'none', borderRadius: 4, color: '#8a8f98', cursor: 'pointer',
        }}
      >
        {show ? 'Hide' : 'Show'}
      </button>
      <button
        onClick={() => { connect(key); setKey(''); }}
        style={{
          padding: '6px 14px', fontSize: 12, background: '#3861fb',
          border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Connect
      </button>
    </div>
  );
}

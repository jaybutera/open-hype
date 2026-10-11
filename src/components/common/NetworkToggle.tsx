import { NETWORK, switchNetwork, type Network } from '../../services/hl/network.ts';

export function NetworkToggle() {
  const pick = (n: Network) => {
    if (n === NETWORK) return;
    if (window.confirm(`Switch to Hyperliquid ${n}? The page reloads and the wallet session for ${NETWORK} ends.`)) switchNetwork(n);
  };
  return (
    <div style={{ display: 'flex', gap: 0 }} title="Hyperliquid network for market data and live orders">
      {(['mainnet', 'testnet'] as const).map(n => (
        <button
          key={n}
          className={NETWORK === n ? 'btn-chip active' : 'btn-chip'}
          onClick={() => pick(n)}
          style={{ padding: '4px 10px', fontSize: 11, textTransform: 'capitalize' }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

import type { PreparedOrder } from '../../services/hl/liveTrader.ts';

interface Props {
  order: PreparedOrder;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Final check before a real order is signed: shows exactly what goes to the exchange. */
export function LiveOrderConfirm({ order, busy, onConfirm, onCancel }: Props) {
  const { summary, wires, leverage } = order;
  const isMainnet = summary.network === 'mainnet';
  const color = summary.side === 'buy' ? '#0ecb81' : '#f6465d';
  return (
    <div data-testid="live-confirm" style={{
      border: `1px solid ${isMainnet ? '#f6465d' : '#f0b90b'}`, padding: 10, fontSize: 12,
      display: 'flex', flexDirection: 'column', gap: 6, background: '#11151f',
    }}>
      <div style={{ fontWeight: 700, color: isMainnet ? '#f6465d' : '#f0b90b' }}>
        {isMainnet ? 'REAL ORDER on Hyperliquid mainnet' : 'Testnet order'}
      </div>
      <div data-testid="live-confirm-account" style={{ color: '#e1e4e8' }}>{summary.account}</div>
      <div>
        <span style={{ color, fontWeight: 700 }}>{summary.side.toUpperCase()}</span>{' '}
        {summary.size} {summary.coin} {summary.kind === 'market' ? `market (worst ${summary.price})` : `@ ${summary.price}`}
      </div>
      <div style={{ color: '#8a8f98' }}>
        ≈ ${summary.notional.toFixed(2)}{leverage ? ` · ${leverage}x` : ''}
        {wires.length > 1 && ` · with ${wires.slice(1).map(w => ('trigger' in w.t ? `${w.t.trigger.tpsl.toUpperCase()} ${w.t.trigger.triggerPx}` : '')).join(', ')}`}
      </div>
      <details style={{ color: '#555' }}>
        <summary style={{ cursor: 'pointer' }}>Payload</summary>
        <pre data-testid="live-payload" style={{ whiteSpace: 'pre-wrap', fontSize: 10, margin: 0 }}>
          {JSON.stringify({ orders: wires, grouping: order.grouping, ...(order.vaultAddress ? { vaultAddress: order.vaultAddress } : {}) }, null, 1)}
        </pre>
      </details>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className={summary.side === 'buy' ? 'btn-long' : 'btn-short'} disabled={busy} onClick={onConfirm} style={{ flex: 1, padding: 8, fontWeight: 700 }}>
          {busy ? 'Sending…' : 'Confirm & send'}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={onCancel} style={{ padding: 8 }}>Cancel</button>
      </div>
    </div>
  );
}

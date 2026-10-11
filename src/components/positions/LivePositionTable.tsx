import { useState } from 'react';
import { useLiveAccountStore, type LivePosition } from '../../store/useLiveAccountStore.ts';
import { useWalletStore } from '../../store/useWalletStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { NETWORK } from '../../services/hl/network.ts';
import {
  cancelLiveOrders, closeLivePosition, placeLivePositionTrigger, type LiveResult,
} from '../../services/hl/liveTrader.ts';

const th = { padding: '6px 8px', textAlign: 'right' as const };
const td = { padding: '8px', textAlign: 'right' as const };
const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const confirmMainnet = (what: string) =>
  NETWORK !== 'mainnet' || window.confirm(`${what} on Hyperliquid mainnet?`);

function TriggerInput({ pos, run }: { pos: LivePosition; run: (f: () => Promise<LiveResult>) => void }) {
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const send = (tpsl: 'tp' | 'sl', v: string, clear: () => void) => {
    if (!v || !confirmMainnet(`Set ${tpsl.toUpperCase()} at ${v} for ${pos.coin}`)) return;
    run(() => placeLivePositionTrigger(pos.coin, tpsl, v));
    clear();
  };
  const input = { width: 70, padding: '3px 6px', fontSize: 11, background: '#1a1f2e', border: '1px solid #2a2f3e', borderRadius: 0, outline: 'none' };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input value={tp} onChange={e => setTp(e.target.value)} placeholder="TP" style={{ ...input, color: '#0ecb81' }}
        onKeyDown={e => e.key === 'Enter' && send('tp', tp, () => setTp(''))} />
      <button className="btn-tp-set" onClick={() => send('tp', tp, () => setTp(''))} style={{ padding: '3px 6px' }}>Set</button>
      <input value={sl} onChange={e => setSl(e.target.value)} placeholder="SL" style={{ ...input, color: '#f6465d' }}
        onKeyDown={e => e.key === 'Enter' && send('sl', sl, () => setSl(''))} />
      <button className="btn-sl-set" onClick={() => send('sl', sl, () => setSl(''))} style={{ padding: '3px 6px' }}>Set</button>
    </div>
  );
}

/** Positions and open orders of the connected Hyperliquid account. */
export function LivePositionTable() {
  const address = useWalletStore(s => s.address);
  const tradingReady = useWalletStore(s => s.tradingStatus === 'ready');
  const { positions, openOrders, accountValue, withdrawable, marginUsed, lastSync, syncError } = useLiveAccountStore();
  const allMids = useMarketStore(s => s.allMids);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LiveResult | null>(null);

  const run = (f: () => Promise<LiveResult>) => {
    setBusy(true);
    setResult(null);
    void f().then(r => { setResult(r); setBusy(false); });
  };

  const box = { background: '#0d1117', borderTop: '1px solid #1a1f2e', fontSize: 13, color: '#e1e4e8', maxHeight: 260, overflowY: 'auto' as const };

  if (!address) {
    return <div style={{ ...box, padding: '20px 16px', color: '#555', textAlign: 'center' }}>Connect a wallet to see your Hyperliquid {NETWORK} account</div>;
  }

  return (
    <div data-testid="live-positions" style={box}>
      <div style={{ display: 'flex', gap: 24, padding: '8px 16px', borderBottom: '1px solid #1a1f2e', color: '#8a8f98', fontSize: 12, alignItems: 'center' }}>
        <span>Account value: <b style={{ color: '#e1e4e8' }}>${fmt(accountValue)}</b></span>
        <span>Withdrawable: <b style={{ color: '#e1e4e8' }}>${fmt(withdrawable)}</b></span>
        <span>Margin used: <b style={{ color: '#e1e4e8' }}>${fmt(marginUsed)}</b></span>
        <span style={{ color: syncError ? '#f6465d' : '#555' }}>
          {syncError ? `Sync failed: ${syncError}` : lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString()}` : 'Loading…'}
        </span>
        {busy && <span style={{ color: '#f0b90b' }}>Sending…</span>}
        {result && (
          <span data-testid="live-result" style={{ color: result.ok ? '#0ecb81' : '#f6465d' }}>{result.message}</span>
        )}
      </div>

      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ padding: '8px 16px', fontWeight: 600, borderBottom: '1px solid #1a1f2e' }}>Positions</div>
          {positions.length === 0 ? (
            <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center' }}>No open positions</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#8a8f98', fontSize: 11 }}>
                  <th style={{ ...th, textAlign: 'left', paddingLeft: 16 }}>Asset</th>
                  <th style={th}>Size</th><th style={th}>Entry</th><th style={th}>Mark</th>
                  <th style={th}>uPnL</th><th style={th}>Liq</th>
                  <th style={{ ...th, textAlign: 'left' }}>TP/SL</th><th style={{ ...th, paddingRight: 16 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  const isLong = pos.szi > 0;
                  return (
                    <tr key={pos.coin} style={{ borderBottom: '1px solid #1a1f2e' }}>
                      <td style={{ ...td, textAlign: 'left', paddingLeft: 16 }}>
                        <span style={{ color: isLong ? '#0ecb81' : '#f6465d', fontWeight: 600 }}>{pos.coin} {isLong ? 'LONG' : 'SHORT'}</span>
                        <div style={{ fontSize: 10, color: '#555' }}>{pos.leverage.value}x {pos.leverage.type}</div>
                      </td>
                      <td style={td}>{Math.abs(pos.szi)}<div style={{ fontSize: 10, color: '#555' }}>${fmt(pos.positionValue, 0)}</div></td>
                      <td style={td}>{pos.entryPx}</td>
                      <td style={td}>{allMids[pos.coin] ?? '-'}</td>
                      <td style={{ ...td, color: pos.unrealizedPnl >= 0 ? '#0ecb81' : '#f6465d', fontWeight: 600 }}>${fmt(pos.unrealizedPnl)}</td>
                      <td style={td}>{pos.liquidationPx ?? '-'}</td>
                      <td style={{ padding: 8 }}>{tradingReady && <TriggerInput pos={pos} run={run} />}</td>
                      <td style={{ ...td, paddingRight: 16 }}>
                        <button
                          className="btn-danger"
                          disabled={!tradingReady || busy}
                          onClick={() => confirmMainnet(`Market close ${pos.coin}`) && run(() => closeLivePosition(pos.coin))}
                          style={{ fontSize: 12, padding: '5px 12px', fontWeight: 600 }}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #1a1f2e' }}>
          <div style={{ padding: '8px 16px', fontWeight: 600, borderBottom: '1px solid #1a1f2e', display: 'flex', justifyContent: 'space-between' }}>
            <span>Open Orders</span>
            {openOrders.length > 0 && tradingReady && (
              <button className="btn-ghost" disabled={busy} onClick={() => run(() => cancelLiveOrders(openOrders))} style={{ fontSize: 11, color: '#f6465d' }}>
                Cancel All
              </button>
            )}
          </div>
          {openOrders.length === 0 ? (
            <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center' }}>No open orders</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#8a8f98', fontSize: 11 }}>
                  <th style={{ ...th, textAlign: 'left', paddingLeft: 16 }}>Asset</th>
                  <th style={th}>Type</th><th style={th}>Price</th><th style={th}>Size</th><th style={{ ...th, paddingRight: 16 }} />
                </tr>
              </thead>
              <tbody>
                {openOrders.map(o => (
                  <tr key={o.oid} data-testid={`live-order-${o.oid}`} style={{ borderBottom: '1px solid #1a1f2e' }}>
                    <td style={{ ...td, textAlign: 'left', paddingLeft: 16, color: o.side === 'buy' ? '#0ecb81' : '#f6465d' }}>
                      {o.coin} {o.side.toUpperCase()}
                    </td>
                    <td style={td}>{o.orderType}{o.reduceOnly ? ' (RO)' : ''}</td>
                    <td style={td}>{o.isTrigger ? `${o.triggerCondition}` : o.limitPx}</td>
                    <td style={td}>{o.sz}{o.sz !== o.origSz && <span style={{ color: '#555' }}> / {o.origSz}</span>}</td>
                    <td style={{ ...td, paddingRight: 16 }}>
                      {tradingReady && (
                        <button className="btn-inline" disabled={busy} onClick={() => run(() => cancelLiveOrders([o]))} style={{ fontSize: 11, color: '#f6465d' }}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

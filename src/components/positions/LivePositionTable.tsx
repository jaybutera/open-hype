import { useState } from 'react';
import { useLiveAccountStore, type LiveFill, type LivePosition } from '../../store/useLiveAccountStore.ts';
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
      <input value={tp} onChange={e => setTp(e.target.value)} placeholder="TP" style={{ ...input, color: 'var(--up)' }}
        onKeyDown={e => e.key === 'Enter' && send('tp', tp, () => setTp(''))} />
      <button className="btn-tp-set" onClick={() => send('tp', tp, () => setTp(''))} style={{ padding: '3px 6px' }}>Set</button>
      <input value={sl} onChange={e => setSl(e.target.value)} placeholder="SL" style={{ ...input, color: 'var(--down)' }}
        onKeyDown={e => e.key === 'Enter' && send('sl', sl, () => setSl(''))} />
      <button className="btn-sl-set" onClick={() => send('sl', sl, () => setSl(''))} style={{ padding: '3px 6px' }}>Set</button>
    </div>
  );
}

type Tab = 'positions' | 'history' | 'balances';
const HISTORY_PAGE = 200;

// Aggregated fills carry a volume-weighted price with float noise; show what a price ladder would.
const fmtPx = (n: number) => n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
const fmtSz = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });
const pnlColor = (n: number) => (n > 0 ? 'var(--up)' : n < 0 ? 'var(--down)' : '#8a8f98');
// Hyperliquid's closedPnl is before fees. Net takes the fee off when it is in USDC; a fee paid in
// another token (HYPE) stays in its own column.
const netPnl = (f: LiveFill) => f.closedPnl - (f.feeToken === 'USDC' ? f.fee : 0);
const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour12: false })}`;
};

function TradeHistory({ fills, loaded }: { fills: LiveFill[]; loaded: boolean }) {
  const [shown, setShown] = useState(HISTORY_PAGE);
  if (!loaded) return <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center' }}>Loading trade history…</div>;
  if (fills.length === 0) return <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center' }}>No trades yet</div>;
  return (
    <>
      <table data-testid="live-history" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#8a8f98', fontSize: 11 }}>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 16 }}>Time</th>
            <th style={{ ...th, textAlign: 'left' }}>Asset</th>
            <th style={{ ...th, textAlign: 'left' }}>Direction</th>
            <th style={th}>Price</th><th style={th}>Size</th><th style={th}>Value</th>
            <th style={th}>Fee</th><th style={th}>Gross</th><th style={{ ...th, paddingRight: 16 }}>Net</th>
          </tr>
        </thead>
        <tbody>
          {fills.slice(0, shown).map(f => (
            <tr key={f.tid} data-testid={`live-fill-${f.tid}`} style={{ borderBottom: '1px solid #1a1f2e' }}>
              <td style={{ ...td, textAlign: 'left', paddingLeft: 16, color: '#8a8f98', whiteSpace: 'nowrap' }}>{fmtTime(f.time)}</td>
              <td style={{ ...td, textAlign: 'left' }}>{f.coin}</td>
              <td style={{ ...td, textAlign: 'left', color: f.side === 'buy' ? 'var(--up)' : 'var(--down)' }}>{f.dir}</td>
              <td style={td}>{fmtPx(f.px)}</td>
              <td style={td}>{fmtSz(f.sz)}</td>
              <td style={td}>${fmt(f.px * f.sz)}</td>
              <td style={{ ...td, color: '#8a8f98' }}>{fmt(f.fee, 4)} {f.feeToken !== 'USDC' ? f.feeToken : ''}</td>
              <td style={{ ...td, color: '#8a8f98' }}>{f.closedPnl ? `$${fmt(f.closedPnl)}` : '-'}</td>
              <td style={{ ...td, paddingRight: 16, color: pnlColor(netPnl(f)), fontWeight: f.closedPnl ? 600 : 400 }}>
                ${fmt(netPnl(f))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {fills.length > shown && (
        <div style={{ padding: 8, textAlign: 'center' }}>
          <button className="btn-ghost" onClick={() => setShown(n => n + HISTORY_PAGE)} style={{ fontSize: 11 }}>
            Show more ({fills.length - shown} older)
          </button>
        </div>
      )}
    </>
  );
}

function Balances() {
  const { spotBalances, perps, spotValue, perpValue } = useLiveAccountStore();
  const sub = { padding: '8px 16px', fontWeight: 600, borderBottom: '1px solid #1a1f2e', display: 'flex', justifyContent: 'space-between' };
  return (
    <div data-testid="live-balances" style={{ display: 'flex' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={sub}><span>Spot</span><span style={{ color: '#8a8f98', fontWeight: 400 }}>${fmt(spotValue)}</span></div>
        {spotBalances.length === 0 ? (
          <div style={{ padding: '20px 16px', color: '#555', textAlign: 'center' }}>No spot balances</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#8a8f98', fontSize: 11 }}>
                <th style={{ ...th, textAlign: 'left', paddingLeft: 16 }}>Coin</th>
                <th style={th}>Total</th><th style={th}>In use</th><th style={{ ...th, paddingRight: 16 }}>USD value</th>
              </tr>
            </thead>
            <tbody>
              {spotBalances.map(b => (
                <tr key={b.token} style={{ borderBottom: '1px solid #1a1f2e' }}>
                  <td style={{ ...td, textAlign: 'left', paddingLeft: 16 }}>{b.coin}</td>
                  <td style={td}>{b.total.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                  <td style={td}>{b.hold ? b.hold.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '-'}</td>
                  <td style={{ ...td, paddingRight: 16 }}>${fmt(b.usdValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #1a1f2e' }}>
        <div style={sub}><span>Perps</span><span style={{ color: '#8a8f98', fontWeight: 400 }}>${fmt(perpValue)}</span></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#8a8f98', fontSize: 11 }}>
              <th style={{ ...th, textAlign: 'left', paddingLeft: 16 }}>Dex</th>
              <th style={th}>Account value</th><th style={th}>Margin used</th><th style={{ ...th, paddingRight: 16 }}>Withdrawable</th>
            </tr>
          </thead>
          <tbody>
            {perps.map(p => (
              <tr key={p.dex} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 16 }}>{p.dex || 'Hyperliquid'}</td>
                <td style={td}>${fmt(p.accountValue)}</td>
                <td style={td}>${fmt(p.marginUsed)}</td>
                <td style={{ ...td, paddingRight: 16 }}>${fmt(p.withdrawable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Positions, open orders, trade history and balances of the connected Hyperliquid account. */
export function LivePositionTable() {
  const address = useWalletStore(s => s.address);
  const tradingReady = useWalletStore(s => s.tradingStatus === 'ready');
  const {
    positions, openOrders, fills, fillsLoaded, accountValue, perpValue, spotValue, unified, withdrawable, marginUsed, lastSync, syncError,
  } = useLiveAccountStore();
  const [tab, setTab] = useState<Tab>('positions');
  const allMids = useMarketStore(s => s.allMids);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LiveResult | null>(null);

  const run = (f: () => Promise<LiveResult>) => {
    setBusy(true);
    setResult(null);
    void f().then(r => { setResult(r); setBusy(false); });
  };

  const box = { background: '#0d1117', borderTop: '1px solid #1a1f2e', fontSize: 13, color: '#e1e4e8', minHeight: '100%' };
  const tabBtn = (t: Tab, label: string) => (
    <button
      key={t}
      data-testid={`live-tab-${t}`}
      onClick={() => setTab(t)}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 0,
        color: tab === t ? '#e1e4e8' : '#8a8f98',
        borderBottom: `2px solid ${tab === t ? '#3861fb' : 'transparent'}`,
      }}
    >
      {label}
    </button>
  );

  if (!address) {
    return <div style={{ ...box, padding: '20px 16px', color: '#555', textAlign: 'center' }}>Connect a wallet to see your Hyperliquid {NETWORK} account</div>;
  }

  return (
    <div data-testid="live-positions" style={box}>
      {/* Summary and tabs stay in view while the panel body scrolls. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#0d1117' }}>
      <div style={{ display: 'flex', gap: 24, padding: '8px 16px', borderBottom: '1px solid #1a1f2e', color: '#8a8f98', fontSize: 12, alignItems: 'center' }}>
        <span>Account value: <b data-testid="live-account-value" style={{ color: '#e1e4e8' }}>${fmt(accountValue)}</b></span>
        <span title={unified ? 'Unified account: perp equity is part of spot USDC, so it is not added to the account value' : undefined}>
          Perps{unified ? ' (in spot)' : ''}: <b style={{ color: '#e1e4e8' }}>${fmt(perpValue)}</b>
        </span>
        <span>Spot: <b style={{ color: '#e1e4e8' }}>${fmt(spotValue)}</b></span>
        <span>Available: <b style={{ color: '#e1e4e8' }}>${fmt(withdrawable)}</b></span>
        <span>Margin used: <b style={{ color: '#e1e4e8' }}>${fmt(marginUsed)}</b></span>
        <span style={{ color: syncError ? 'var(--down)' : '#555' }}>
          {syncError ? `Sync failed: ${syncError}` : lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString()}` : 'Loading…'}
        </span>
        {busy && <span style={{ color: '#f0b90b' }}>Sending…</span>}
        {result && (
          <span data-testid="live-result" style={{ color: result.ok ? 'var(--up)' : 'var(--down)' }}>{result.message}</span>
        )}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #1a1f2e', paddingLeft: 4 }}>
        {tabBtn('positions', `Positions (${positions.length}) / Orders (${openOrders.length})`)}
        {tabBtn('history', 'Trade History')}
        {tabBtn('balances', 'Balances')}
      </div>
      </div>

      {tab === 'history' && <TradeHistory fills={fills} loaded={fillsLoaded} />}
      {tab === 'balances' && <Balances />}

      {tab === 'positions' && <div style={{ display: 'flex' }}>
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
                        <span style={{ color: isLong ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>{pos.coin} {isLong ? 'LONG' : 'SHORT'}</span>
                        <div style={{ fontSize: 10, color: '#555' }}>{pos.leverage.value}x {pos.leverage.type}</div>
                      </td>
                      <td style={td}>{Math.abs(pos.szi)}<div style={{ fontSize: 10, color: '#555' }}>${fmt(pos.positionValue, 0)}</div></td>
                      <td style={td}>{pos.entryPx}</td>
                      <td style={td}>{allMids[pos.coin] ?? '-'}</td>
                      <td style={{ ...td, color: pos.unrealizedPnl >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>${fmt(pos.unrealizedPnl)}</td>
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
              <button className="btn-ghost" disabled={busy} onClick={() => run(() => cancelLiveOrders(openOrders))} style={{ fontSize: 11, color: 'var(--down)' }}>
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
                    <td style={{ ...td, textAlign: 'left', paddingLeft: 16, color: o.side === 'buy' ? 'var(--up)' : 'var(--down)' }}>
                      {o.coin} {o.side.toUpperCase()}
                    </td>
                    <td style={td}>{o.orderType}{o.reduceOnly ? ' (RO)' : ''}</td>
                    <td style={td}>{o.isTrigger ? `${o.triggerCondition}` : o.limitPx}</td>
                    <td style={td}>{o.sz}{o.sz !== o.origSz && <span style={{ color: '#555' }}> / {o.origSz}</span>}</td>
                    <td style={{ ...td, paddingRight: 16 }}>
                      {tradingReady && (
                        <button className="btn-inline" disabled={busy} onClick={() => run(() => cancelLiveOrders([o]))} style={{ fontSize: 11, color: 'var(--down)' }}>
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
      </div>}
    </div>
  );
}

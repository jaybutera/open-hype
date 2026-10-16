import { useEffect, useRef, useState } from 'react';
import { useAiTradeStore } from '../../store/useAiTradeStore.ts';
import { useSettingsStore } from '../../store/useSettingsStore.ts';
import { useWalletStore } from '../../store/useWalletStore.ts';
import { useLiveAccountStore } from '../../store/useLiveAccountStore.ts';
import { useAccountStore } from '../../store/useAccountStore.ts';
import { describeAction, isOpen, type TradeProposal } from '../../services/ai/trades.ts';
import { previewTrade, executeTrade, type TradePreview } from '../../services/ai/tradeExec.ts';
import { formatEt } from '../../utils/chartTime.ts';
import { LiveOrderConfirm } from './LiveOrderConfirm.tsx';

/** Finished proposals stay listed this long. */
const RECENT_MS = 10 * 60_000;
const REFRESH_MS = 3000;

/** "HH:MM ET" */
const etTime = (ms: number) => formatEt(ms).slice(11);

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--up)', failed: 'var(--down)', rejected: '#8a8f98', withdrawn: '#8a8f98', expired: '#8a8f98',
};

function ProposalCard({ trade }: { trade: TradeProposal }) {
  const mode = useSettingsStore(s => s.mode);
  const tradingStatus = useWalletStore(s => s.tradingStatus);
  const subAccount = useWalletStore(s => s.subAccount);
  const liveOrders = useLiveAccountStore(s => s.openOrders);
  const livePositions = useLiveAccountStore(s => s.positions);
  const paperOrders = useAccountStore(s => s.paperOrders);
  const paperPositions = useAccountStore(s => s.paperPositions);
  const autoConfirm = useAiTradeStore(s => s.autoConfirm);
  const claim = useAiTradeStore(s => s.claim);
  const report = useAiTradeStore(s => s.report);
  const reject = useAiTradeStore(s => s.reject);

  const [preview, setPreview] = useState<TradePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const autoTried = useRef(false);
  const pending = trade.status === 'pending';

  // Keep the card current: market worst prices, positions and orders move.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setTick(n => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, [pending]);

  useEffect(() => {
    if (!pending || busy) return;
    let alive = true;
    previewTrade(trade).then(
      p => { if (alive) { setPreview(p); setError(null); } },
      e => { if (alive) { setPreview(null); setError(e instanceof Error ? e.message : String(e)); } },
    );
    return () => { alive = false; };
  }, [trade, pending, busy, tick, mode, tradingStatus, subAccount, liveOrders, livePositions, paperOrders, paperPositions]);

  const run = async (decidedBy: 'user' | 'auto') => {
    setBusy(true);
    setError(null);
    try {
      await claim(trade.id, decidedBy);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const r = await executeTrade(trade);
    await report(trade.id, r);
    setBusy(false);
  };

  useEffect(() => {
    if (!autoConfirm || !pending || busy || autoTried.current || !preview) return;
    autoTried.current = true;
    void run('auto');
  });

  const isLive = trade.mode === 'live';
  const header = (
    <div style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ fontWeight: 700, color: '#c49bff' }}>Claude proposes</span>
      <span style={{ color: isLive ? 'var(--down)' : '#f0b90b' }}>{isLive ? 'LIVE' : 'PAPER'}</span>
      <span style={{ marginLeft: 'auto', color: '#555', fontSize: 10 }}>until {etTime(trade.expiresAt)}</span>
    </div>
  );
  const note = trade.note && <div style={{ fontSize: 11, color: '#8a8f98', fontStyle: 'italic' }}>{trade.note}</div>;
  const extra = preview?.lines.length ? (
    <div style={{ fontSize: 11, color: '#e1e4e8', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {preview.lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  ) : null;

  if (trade.status === 'executing') {
    return (
      <div data-testid="ai-trade-card" style={cardStyle(isLive)}>
        {header}
        <div style={{ fontSize: 11, color: '#e1e4e8' }}>{describeAction(trade.action)}</div>
        <div style={{ fontSize: 11, color: '#f0b90b' }}>Sending{trade.decidedBy === 'auto' ? ' (auto-confirmed)' : ''}…</div>
      </div>
    );
  }

  if (preview?.prepared) {
    return (
      <div data-testid="ai-trade-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {header}
        {note}
        {extra}
        <LiveOrderConfirm order={preview.prepared} busy={busy} onConfirm={() => void run('user')} onCancel={() => void reject(trade.id)} />
        {error && <div style={{ fontSize: 11, color: 'var(--down)' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div data-testid="ai-trade-card" style={cardStyle(isLive)}>
      {header}
      {note}
      {!preview && <div style={{ fontSize: 11, color: '#e1e4e8' }}>{describeAction(trade.action)}</div>}
      {extra}
      {error && <div data-testid="ai-trade-error" style={{ fontSize: 11, color: 'var(--down)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className={trade.action.kind === 'order' && trade.action.side === 'sell' ? 'btn-short' : 'btn-long'}
          disabled={busy || !preview}
          onClick={() => void run('user')}
          style={{ flex: 1, padding: 6, fontWeight: 700, fontSize: 12 }}
        >
          {busy ? 'Sending…' : 'Confirm & send'}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => void reject(trade.id)} style={{ padding: 6, fontSize: 12 }}>
          Reject
        </button>
      </div>
    </div>
  );
}

function cardStyle(isLive: boolean) {
  return {
    border: `1px solid ${isLive ? 'var(--down)' : '#f0b90b'}`, padding: 8, background: '#11151f',
    display: 'flex', flexDirection: 'column' as const, gap: 6,
  };
}

/**
 * Trades proposed by the AI (propose_* tools of the hl-chart MCP). With
 * auto-run on (the default) each proposal runs as soon as it can, paper or
 * live; with it off, each waits for Confirm. The result goes back to the AI
 * session that proposed it.
 */
export function AiTradePanel() {
  const trades = useAiTradeStore(s => s.trades);
  const autoConfirm = useAiTradeStore(s => s.autoConfirm);
  const setAutoConfirm = useAiTradeStore(s => s.setAutoConfirm);
  const [, setNow] = useState(0);
  const [hidden, setHidden] = useState<string[]>([]);

  // Re-render so finished rows age out.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const open = trades.filter(t => isOpen(t.status));
  const recent = trades
    .filter(t => !isOpen(t.status) && !hidden.includes(t.id) && now - (t.decidedAt ?? t.createdAt) < RECENT_MS)
    .slice(-4);

  if (!open.length && !recent.length) return null;

  return (
    <div data-testid="ai-trade-panel" style={{ borderTop: '1px solid #1a1f2e', paddingTop: 8, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, color: '#8a8f98', fontWeight: 600 }}>Claude trades</span>
      <label
        title="Send Claude's proposals (paper and live) as soon as they arrive. Off: each waits for Confirm."
        style={{ fontSize: 10, color: '#8a8f98', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
      >
        <input type="checkbox" checked={autoConfirm} onChange={e => setAutoConfirm(e.target.checked)} style={{ margin: 0 }} />
        Run Claude's trades without confirming
      </label>
      {open.map(t => <ProposalCard key={t.id} trade={t} />)}
      {recent.map(t => (
        <div key={t.id} data-testid="ai-trade-row" title={t.note ?? ''} style={{ display: 'flex', gap: 6, fontSize: 11, alignItems: 'baseline' }}>
          <span style={{ color: STATUS_COLOR[t.status] ?? '#8a8f98', whiteSpace: 'nowrap' }}>
            {t.status}{t.decidedBy === 'auto' ? ' (auto)' : ''}
          </span>
          <span style={{ color: '#e1e4e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.result?.message ?? ''}>
            {describeAction(t.action)}
          </span>
          <button
            className="btn-inline"
            aria-label="Dismiss"
            onClick={() => setHidden(h => [...h, t.id])}
            style={{ marginLeft: 'auto', fontSize: 11, color: '#555' }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

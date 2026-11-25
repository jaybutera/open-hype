import { useSignalStore } from '../../store/useSignalStore.ts';
import { useMarketStore } from '../../store/useMarketStore.ts';
import { useTradeSetupStore } from '../../store/useTradeSetupStore.ts';
import { signalRr, type StrategySignal } from '../../services/signals/book.ts';
import { formatEt, utcToChartTime } from '../../utils/chartTime.ts';

/** Cards shown; older signals are counted in the header. The right column does not scroll. */
const MAX_CARDS = 4;

const STATUS_COLOR: Record<StrategySignal['status'], string> = {
  resting: '#f0b90b',
  filled: '#3d9bff',
  won: 'var(--up)',
  lost: 'var(--down)',
  cancelled: '#8a8f98',
};

function px(p: number): string {
  return String(Number(p.toPrecision(8)));
}

/** "HH:MM ET", with the date in front when the signal is not from today. */
function when(ms: number, now: number): string {
  const et = formatEt(ms);
  return et.slice(0, 10) === formatEt(now).slice(0, 10) ? et.slice(11) : `${et.slice(5, 10)} ${et.slice(11)}`;
}

/** Strategy, status with its reason, and the runner's note; the card itself only has room for two lines. */
function tooltip(s: StrategySignal): string {
  const head = s.status === 'resting' ? s.strategy : `${s.strategy}: ${s.status}${s.statusNote ? `, ${s.statusNote}` : ''}`;
  return s.note ? `${head}\n${s.note}` : head;
}

/** The pane that shows `asset`; when none does, the active pane is moved to it. */
function paneFor(asset: string) {
  const market = useMarketStore.getState();
  const shown = Object.entries(market.panes).find(([, p]) => p?.asset === asset);
  if (shown) return shown[0] as typeof market.activePaneId;
  market.setAsset(asset);
  void market.loadCandles();
  return market.activePaneId;
}

/**
 * Turn a signal into one of the app's own setups (what Set Up Long / Short draws), at the
 * signal's entry, stop and target. Nothing is sent: the setup box is executed like any other.
 */
function setUp(s: StrategySignal) {
  const at = { paneId: paneFor(s.asset), asset: s.asset };
  const setups = useTradeSetupStore.getState();
  setups.startSetupAt(s.side === 'long' ? 'buy' : 'sell', s.entry, utcToChartTime(Math.floor(s.time / 1000)), at);
  setups.addClick(s.stop, null, at, true);
  setups.addClick(s.target, null, at);
}

const isOpen = (s: StrategySignal) => s.status === 'resting' || s.status === 'filled';

/**
 * Trade setups reported by a strategy runner (POST /api/signals), plans still
 * in play first. Clicking a card draws the setup with its sweep and structure break on the chart, and
 * moves the active pane to the signal's asset when no pane shows it. "set up"
 * makes it one of the app's own setups, to execute like any other.
 */
export function SignalPanel() {
  const signals = useSignalStore(s => s.signals);
  const enabledIds = useSignalStore(s => s.enabledIds);
  const unseenIds = useSignalStore(s => s.unseenIds);
  const toggle = useSignalStore(s => s.toggle);
  const dismiss = useSignalStore(s => s.dismiss);
  const clearAll = useSignalStore(s => s.clearAll);

  if (signals.length === 0) return null;

  const onClick = (s: StrategySignal) => {
    const turningOn = !enabledIds.includes(s.id);
    toggle(s.id);
    if (turningOn) paneFor(s.asset);
  };

  const now = Date.now();
  // Plans still in play first; the list arrives newest first and the sort is stable.
  const shown = [...signals].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a))).slice(0, MAX_CARDS);
  const hidden = signals.length - shown.length;

  return (
    <div data-testid="signal-panel" style={{ borderTop: '1px solid #1a1f2e', paddingTop: 8, marginTop: 4, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#8a8f98', fontWeight: 600 }}>Strategy signals</span>
        {hidden > 0 && <span style={{ fontSize: 10, color: '#555', marginLeft: 6 }}>+{hidden} older</span>}
        <button className="btn-ghost" onClick={clearAll} style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 6px' }}>
          clear
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shown.map(s => {
          const on = enabledIds.includes(s.id);
          const unseen = unseenIds.includes(s.id);
          const over = s.status === 'cancelled' || s.status === 'won' || s.status === 'lost';
          const sideColor = s.side === 'long' ? 'var(--up)' : 'var(--down)';
          const label = `${s.strategy} ${s.asset} ${s.side}${s.tf ? ` ${s.tf}` : ''}`;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'stretch' }}>
              <button
                className={`btn-toggle${on ? ' active' : ''}`}
                aria-pressed={on}
                aria-label={label}
                title={tooltip(s)}
                onClick={() => onClick(s)}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', padding: '3px 6px', fontSize: 11, lineHeight: 1.4,
                  borderLeft: `2px solid ${sideColor}`,
                  outline: unseen ? '1px solid #f0b90b' : undefined,
                  opacity: over && !on ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {unseen && <span data-testid="signal-new" style={{ color: '#f0b90b' }}>●</span>}
                  <span style={{ color: sideColor, fontWeight: 700 }}>{s.side === 'long' ? 'LONG' : 'SHORT'}</span>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.asset.replace(/^xyz:/, '')}</span>
                  {s.tf && <span style={{ color: '#8a8f98' }}>{s.tf}</span>}
                  {s.status !== 'resting' && <span style={{ color: STATUS_COLOR[s.status] }}>{s.status}</span>}
                  <span style={{ marginLeft: 'auto', color: '#8a8f98' }}>{when(s.time, now)}</span>
                </div>
                <div style={{ color: '#c5c9d1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {px(s.entry)} <span style={{ color: '#555' }}>sl</span> {px(s.stop)} <span style={{ color: '#555' }}>tp</span> {px(s.target)}{' '}
                  <span style={{ color: '#8a8f98' }}>{signalRr(s).toFixed(1)}R</span>
                </div>
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <button
                  className="btn-inline"
                  aria-label={`Remove ${label}`}
                  title="Remove"
                  onClick={() => dismiss(s.id)}
                  style={{ fontSize: 11, color: '#555' }}
                >
                  ×
                </button>
                <button
                  className="btn-inline"
                  aria-label={`Set up ${label}`}
                  title={`Draw a ${s.side} setup at these levels, sized by your risk, ready to execute`}
                  onClick={() => setUp(s)}
                  style={{ fontSize: 10, color: sideColor, whiteSpace: 'nowrap' }}
                >
                  set up
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

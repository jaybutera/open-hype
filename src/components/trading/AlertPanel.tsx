import { useAlertStore } from '../../store/useAlertStore.ts';
import { describeAlert } from '../../services/ai/alerts.ts';
import { formatEt } from '../../utils/chartTime.ts';

/** "HH:MM ET" from a UTC ms timestamp. */
function etTime(ms: number): string {
  return formatEt(ms).slice(11);
}

/**
 * Price alerts armed on the dev server (alt+click on the chart, or set_alert
 * from the hl-chart MCP). Fired alerts stay listed until removed.
 */
export function AlertPanel() {
  const alerts = useAlertStore(s => s.alerts);
  const error = useAlertStore(s => s.error);
  const remove = useAlertStore(s => s.remove);

  if (alerts.length === 0 && !error) return null;

  return (
    <div data-testid="alert-panel" style={{ borderTop: '1px solid #1a1f2e', paddingTop: 8, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#8a8f98', fontWeight: 600 }}>Alerts</span>
        <span style={{ fontSize: 10, color: '#3a4050', marginLeft: 6 }}>alt+click chart to add</span>
      </div>
      {error && <div style={{ fontSize: 10, color: '#f6465d', marginBottom: 4 }}>{error}</div>}
      {alerts.map(a => {
        const fired = a.status === 'fired';
        return (
          <div
            key={a.id}
            title={a.note ?? ''}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '2px 0', color: fired ? '#f6465d' : '#e1e4e8' }}
          >
            <span style={{ color: fired ? '#f6465d' : '#f0b90b' }}>⏰</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{describeAlert(a)}</span>
            <span style={{ marginLeft: 'auto', color: '#8a8f98', fontSize: 10, whiteSpace: 'nowrap' }}>
              {fired && a.firedAt !== undefined ? `fired ${a.firedPrice} ${etTime(a.firedAt)}` : 'armed'}
            </span>
            <button
              className="btn-inline"
              aria-label={`Remove alert ${describeAlert(a)}`}
              title="Remove"
              onClick={() => remove(a.id)}
              style={{ fontSize: 11, color: '#555' }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

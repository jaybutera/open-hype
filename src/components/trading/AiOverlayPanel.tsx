import { Fragment } from 'react';
import { useAiOverlayStore } from '../../store/useAiOverlayStore.ts';
import type { OverlaySet } from '../../services/ai/types.ts';

/** Group sets by push batch, keeping push order. */
function byBatch(sets: OverlaySet[]): OverlaySet[][] {
  const groups: OverlaySet[][] = [];
  const index = new Map<string, number>();
  for (const s of sets) {
    const i = index.get(s.batch);
    if (i === undefined) {
      index.set(s.batch, groups.length);
      groups.push([s]);
    } else {
      groups[i].push(s);
    }
  }
  return groups;
}

/**
 * Toggle chips for overlay sets pushed by the AI (via the hl-chart MCP server).
 * Nothing is drawn until a chip is toggled on.
 */
export function AiOverlayPanel() {
  const sets = useAiOverlayStore(s => s.sets);
  const enabledIds = useAiOverlayStore(s => s.enabledIds);
  const connected = useAiOverlayStore(s => s.connected);
  const toggle = useAiOverlayStore(s => s.toggle);
  const remove = useAiOverlayStore(s => s.remove);
  const clearAll = useAiOverlayStore(s => s.clearAll);

  if (sets.length === 0) {
    if (connected) return null;
    return (
      <div data-testid="ai-overlay-status" style={{ fontSize: 10, color: '#3a4050', marginTop: 4 }}>
        AI overlays: not connected to dev server
      </div>
    );
  }

  return (
    <div data-testid="ai-overlay-panel" style={{ borderTop: '1px solid #1a1f2e', paddingTop: 8, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#8a8f98', fontWeight: 600 }}>AI overlays</span>
        {!connected && <span style={{ fontSize: 10, color: '#555', marginLeft: 6 }}>(offline)</span>}
        <button
          className="btn-ghost"
          onClick={clearAll}
          style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 6px' }}
        >
          clear
        </button>
      </div>
      {byBatch(sets).map((group, gi) => (
        <Fragment key={group[0].batch}>
          {gi > 0 && <div style={{ borderTop: '1px solid #1a1f2e', margin: '6px 0' }} />}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {group.map(set => {
              const on = enabledIds.includes(set.id);
              return (
                <span key={set.id} style={{ display: 'inline-flex', alignItems: 'stretch' }}>
                  <button
                    className={`btn-toggle${on ? ' active' : ''}`}
                    aria-pressed={on}
                    title={set.description ?? set.name}
                    onClick={() => toggle(set.id)}
                    style={{
                      fontSize: 11,
                      padding: '3px 6px',
                      borderLeft: `2px solid ${set.color}`,
                      maxWidth: 180,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {set.name}
                  </button>
                  <button
                    className="btn-inline"
                    aria-label={`Remove ${set.name}`}
                    title="Remove"
                    onClick={() => remove(set.id)}
                    style={{ fontSize: 11, color: '#555' }}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

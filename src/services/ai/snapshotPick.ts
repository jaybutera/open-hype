/**
 * Several app tabs can be connected to one dev server (laptop browser, a
 * forgotten second tab). Each answers a snapshot request; the server keeps the
 * one the user is using: focused first, then visible, then the latest input.
 * Ties go to the earliest reply.
 */
import type { ChartSnapshot } from './types.ts';

function score(s: ChartSnapshot): [number, number] {
  const c = s.client;
  if (!c) return [0, 0];
  return [(c.focused ? 2 : 0) + (c.visible ? 1 : 0), c.lastInputAt || 0];
}

export function pickSnapshot(replies: ChartSnapshot[]): ChartSnapshot | null {
  let best: ChartSnapshot | null = null;
  let bestScore: [number, number] = [-1, -1];
  for (const r of replies) {
    const sc = score(r);
    if (sc[0] > bestScore[0] || (sc[0] === bestScore[0] && sc[1] > bestScore[1])) {
      best = r;
      bestScore = sc;
    }
  }
  return best;
}

/** The snapshot as the AI sees it: the per-pane candles and client info stay on the server. */
export function publicSnapshot(s: ChartSnapshot): Omit<ChartSnapshot, 'panes' | 'client'> & { panes?: Array<{ pane: string; asset: string; interval: string }> } {
  const { panes, client: _client, ...rest } = s;
  return panes && panes.length > 1
    ? { ...rest, panes: panes.map(p => ({ pane: p.pane, asset: p.asset, interval: p.interval })) }
    : rest;
}

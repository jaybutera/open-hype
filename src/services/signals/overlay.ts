import type { OverlaySet, OverlayShape } from '../ai/types.ts';
import { signalRr, type StrategySignal } from './book.ts';

const UP = '#0ecb81';
const DOWN = '#f6465d';
const ENTRY = '#e1e4e8';

/** Trim float noise without forcing a fixed number of decimals. */
function px(p: number): string {
  return String(Number(p.toPrecision(8)));
}

/**
 * What a signal draws: its context shapes (sweep, structure break, gap) under
 * the setup box. The box has a reward zone and a risk zone from the signal's
 * time to the right edge, or to `endTime` once the plan is over.
 */
export function signalOverlaySet(s: StrategySignal, now = Date.now()): OverlaySet {
  const live = s.endTime === undefined;
  const t2 = Math.max(s.endTime ?? now, s.time);
  const span = live ? { t2, t2Now: true } : { t2 };
  const lineSpan = live ? { from: s.time, to: t2, toNow: true } : { from: s.time, to: t2 };
  const rr = signalRr(s);

  const setup: OverlayShape[] = [
    { type: 'box', t1: s.time, ...span, p1: Math.max(s.entry, s.target), p2: Math.min(s.entry, s.target), color: UP },
    { type: 'box', t1: s.time, ...span, p1: Math.max(s.entry, s.stop), p2: Math.min(s.entry, s.stop), color: DOWN },
    { type: 'hline', price: s.target, color: UP, style: 'solid', ...lineSpan, text: `Target ${px(s.target)}  ${rr.toFixed(1)}R` },
    { type: 'hline', price: s.stop, color: DOWN, style: 'solid', ...lineSpan, text: `Stop ${px(s.stop)}` },
    { type: 'hline', price: s.entry, color: ENTRY, style: 'solid', ...lineSpan, text: `${s.side === 'long' ? 'Long' : 'Short'} ${px(s.entry)}` },
  ];

  return {
    id: `signal:${s.id}`,
    batch: 'signals',
    name: `${s.strategy} ${s.side}`,
    asset: s.asset,
    color: s.side === 'long' ? UP : DOWN,
    createdAt: s.receivedAt,
    shapes: [...s.shapes, ...setup],
  };
}

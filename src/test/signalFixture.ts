import type { StrategySignal } from '../services/signals/book.ts';

/** A resting v3 short on xyz:SP500 for tests. */
export function signal(key: string, over: Partial<StrategySignal> = {}): StrategySignal {
  return {
    id: `v3:${key}`, source: 'v3', key, strategy: 'v3', asset: 'xyz:SP500', side: 'short', tf: '15m',
    time: 1_795_000_000_000, entry: 7609, stop: 7649.8, target: 7523.6, status: 'resting',
    shapes: [], receivedAt: 1, updatedAt: 1, ...over,
  };
}

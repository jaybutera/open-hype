import { describe, it, expect } from 'vitest';
import { pickSnapshot, publicSnapshot } from '../snapshotPick.ts';
import type { ChartSnapshot } from '../types.ts';

function s(asset: string, client?: ChartSnapshot['client']): ChartSnapshot {
  return {
    takenAt: 0, mode: 'paper', replay: false, pane: 'primary', asset, interval: '5m',
    timezone: 'America/New_York', visible: { from: 0, to: 0, bars: 0 }, candles: [], mid: null,
    position: null, orders: [], setups: [], pendingSetup: null,
    trading: { status: 'none', account: null, network: 'mainnet' },
    fibs: [], lines: [], overlays: [], ...(client ? { client } : {}),
  };
}

describe('pickSnapshot', () => {
  it('prefers the focused tab, then the visible one, then the latest input', () => {
    const bg = s('xyz:XYZ100', { focused: false, visible: false, lastInputAt: 900 });
    const vis = s('BTC', { focused: false, visible: true, lastInputAt: 100 });
    const vis2 = s('ETH', { focused: false, visible: true, lastInputAt: 500 });
    const foc = s('xyz:SP500', { focused: true, visible: true, lastInputAt: 1 });
    expect(pickSnapshot([bg, vis, foc])?.asset).toBe('xyz:SP500');
    expect(pickSnapshot([bg, vis, vis2])?.asset).toBe('ETH');
    expect(pickSnapshot([bg])?.asset).toBe('xyz:XYZ100');
    expect(pickSnapshot([s('A'), s('B')])?.asset).toBe('A');
    expect(pickSnapshot([])).toBeNull();
  });

  it('keeps pane candles and client info off the public view', () => {
    const x = { ...s('xyz:SP500', { focused: true, visible: true, lastInputAt: 1 }), panes: [
      { pane: 'primary' as const, asset: 'xyz:XYZ100', interval: '5m', candles: [] },
      { pane: 'secondary' as const, asset: 'xyz:SP500', interval: '5m', candles: [] },
    ] };
    const p = publicSnapshot(x);
    expect('client' in p).toBe(false);
    expect(p.panes).toEqual([
      { pane: 'primary', asset: 'xyz:XYZ100', interval: '5m' },
      { pane: 'secondary', asset: 'xyz:SP500', interval: '5m' },
    ]);
  });
});

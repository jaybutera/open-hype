import { describe, it, expect } from 'vitest';
import { buildAssetIndex, dexOf } from '../assets.ts';
import { META, XYZ_META } from '../../../test/hlMocks.ts';
import type { Meta } from '../../../types/market.ts';

describe('asset ids (docs: asset-ids)', () => {
  it('core perps use the meta index; HIP-3 perps use 100000 + dexIndex*10000 + index', () => {
    const idx = buildAssetIndex(META as unknown as Meta, [{ dex: 'xyz', meta: XYZ_META as unknown as Meta }], [null, { name: 'xyz' }]);
    expect(idx.get('BTC')?.assetId).toBe(0);
    expect(idx.get('ETH')?.assetId).toBe(1);
    expect(idx.get('xyz:XYZ100')?.assetId).toBe(110000);
    expect(idx.get('xyz:TSLA')).toMatchObject({ assetId: 110001, onlyIsolated: true, szDecimals: 3 });
    expect(idx.get('HPOS')).toMatchObject({ isDelisted: true, onlyIsolated: true });
  });

  it('follows the dex position from perpDexs, which differs on testnet', () => {
    const idx = buildAssetIndex(null, [{ dex: 'xyz', meta: XYZ_META as unknown as Meta }], [null, { name: 'test' }, { name: 'unit' }, { name: 'xyz' }]);
    expect(idx.get('xyz:XYZ100')?.assetId).toBe(130000);
  });

  it('omits a dex that perpDexs does not list', () => {
    const idx = buildAssetIndex(null, [{ dex: 'xyz', meta: XYZ_META as unknown as Meta }], [null]);
    expect(idx.has('xyz:XYZ100')).toBe(false);
  });

  it('dexOf', () => {
    expect(dexOf('BTC')).toBe('');
    expect(dexOf('xyz:TSLA')).toBe('xyz');
  });
});

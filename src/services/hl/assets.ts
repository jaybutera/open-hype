import type { Meta } from '../../types/market.ts';

export interface AssetInfo {
  coin: string;
  /** Exchange asset id: meta index for core perps, 100000 + dexIndex*10000 + index for builder (HIP-3) perps. */
  assetId: number;
  szDecimals: number;
  maxLeverage: number;
  /** Cross margin is unavailable; leverage updates must be isolated. */
  onlyIsolated: boolean;
  isDelisted: boolean;
}

interface UniverseEntry {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  marginMode?: string;
  isDelisted?: boolean;
}

/**
 * Build coin -> asset lookup. `perpDexs` is the raw info response
 * (index 0 is null for the core dex); builder dex ids come from it so the
 * mapping stays correct on testnet, where dex indices differ from mainnet.
 */
export function buildAssetIndex(
  coreMeta: Meta | null,
  dexMetas: { dex: string; meta: Meta | null }[],
  perpDexs: ({ name: string } | null)[],
): Map<string, AssetInfo> {
  const out = new Map<string, AssetInfo>();
  const add = (u: UniverseEntry, assetId: number) => {
    out.set(u.name, {
      coin: u.name,
      assetId,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      onlyIsolated: !!u.onlyIsolated || u.marginMode === 'strictIsolated' || u.marginMode === 'noCross',
      isDelisted: !!u.isDelisted,
    });
  };
  (coreMeta?.universe as UniverseEntry[] | undefined)?.forEach((u, i) => add(u, i));
  for (const { dex, meta } of dexMetas) {
    const dexIndex = perpDexs.findIndex(d => d?.name === dex);
    if (dexIndex <= 0 || !meta) continue;
    (meta.universe as UniverseEntry[]).forEach((u, i) => add(u, 100000 + dexIndex * 10000 + i));
  }
  return out;
}

/** The info-endpoint `dex` parameter for a coin ('' for core perps). */
export function dexOf(coin: string): string {
  const i = coin.indexOf(':');
  return i > 0 ? coin.slice(0, i) : '';
}

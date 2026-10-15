/**
 * Which GEXBot ticker a chart asset's options are on, if any.
 *
 * The xyz dex lists the cash indexes under its own names; its single-name
 * perps carry the stock's ticker, so those map when GEXBot lists the same
 * ticker. Crypto perps map to nothing.
 */
const INDEX_ALIASES: Record<string, string> = {
  'xyz:SP500': 'SPX',
  'xyz:XYZ100': 'NDX',
  'xyz:VIX': 'VIX',
};

export function gexTickerFor(asset: string, known: ReadonlySet<string> | null): string | null {
  const alias = INDEX_ALIASES[asset];
  if (alias) return known === null || known.has(alias) ? alias : null;
  if (!asset.startsWith('xyz:')) return null;
  const name = asset.slice(4);
  if (known === null) return null;
  return known.has(name) ? name : null;
}

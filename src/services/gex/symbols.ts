/**
 * Which GEXBot ticker a chart asset's options are on, if any.
 *
 * The xyz dex lists the cash indexes under its own names; its single-name
 * perps carry the stock's ticker, so those map when GEXBot lists the same
 * ticker. A crypto perp maps to a spot ETF on its coin when there is one
 * (GEX_PROXIES); its strikes are rescaled to the coin's price (scaleGex).
 */
const INDEX_ALIASES: Record<string, string> = {
  'xyz:SP500': 'SPX',
  'xyz:XYZ100': 'NDX',
  'xyz:VIX': 'VIX',
};

/** Perp coin -> spot ETF whose options stand in for the coin's. */
export const GEX_PROXIES: Record<string, string> = {
  BTC: 'IBIT',
};

/** The perp coin a proxy ETF ticker stands in for, or null. */
export function proxyCoinFor(ticker: string): string | null {
  for (const [coin, etf] of Object.entries(GEX_PROXIES)) if (etf === ticker) return coin;
  return null;
}

export function gexTickerFor(asset: string, known: ReadonlySet<string> | null): string | null {
  const proxy = GEX_PROXIES[asset];
  if (proxy) return known === null || known.has(proxy) ? proxy : null;
  const alias = INDEX_ALIASES[asset];
  if (alias) return known === null || known.has(alias) ? alias : null;
  if (!asset.startsWith('xyz:')) return null;
  const name = asset.slice(4);
  if (known === null) return null;
  return known.has(name) ? name : null;
}

import type { SymbolHit } from './types';

export interface PopularSymbol {
  symbol: string;
  name: string;
}

export const POPULAR_SYMBOLS: PopularSymbol[] = [
  // Mega-cap tech
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. Class A' },
  { symbol: 'GOOG', name: 'Alphabet Inc. Class C' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'AVGO', name: 'Broadcom Inc.' },
  { symbol: 'ORCL', name: 'Oracle Corporation' },
  { symbol: 'CRM', name: 'Salesforce Inc.' },
  { symbol: 'ADBE', name: 'Adobe Inc.' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'AMD', name: 'Advanced Micro Devices Inc.' },
  { symbol: 'INTC', name: 'Intel Corporation' },
  { symbol: 'QCOM', name: 'Qualcomm Inc.' },
  { symbol: 'TXN', name: 'Texas Instruments Inc.' },
  { symbol: 'MU', name: 'Micron Technology Inc.' },
  { symbol: 'AMAT', name: 'Applied Materials Inc.' },
  { symbol: 'CSCO', name: 'Cisco Systems Inc.' },
  { symbol: 'IBM', name: 'International Business Machines' },
  { symbol: 'NOW', name: 'ServiceNow Inc.' },
  { symbol: 'PLTR', name: 'Palantir Technologies Inc.' },
  { symbol: 'SNOW', name: 'Snowflake Inc.' },
  { symbol: 'UBER', name: 'Uber Technologies Inc.' },
  { symbol: 'LYFT', name: 'Lyft Inc.' },
  { symbol: 'SHOP', name: 'Shopify Inc.' },
  { symbol: 'SQ', name: 'Block Inc.' },
  { symbol: 'PYPL', name: 'PayPal Holdings Inc.' },
  { symbol: 'COIN', name: 'Coinbase Global Inc.' },
  { symbol: 'HOOD', name: 'Robinhood Markets Inc.' },
  { symbol: 'RBLX', name: 'Roblox Corporation' },
  { symbol: 'U', name: 'Unity Software Inc.' },
  { symbol: 'SNAP', name: 'Snap Inc.' },
  { symbol: 'PINS', name: 'Pinterest Inc.' },
  { symbol: 'SPOT', name: 'Spotify Technology' },
  { symbol: 'ABNB', name: 'Airbnb Inc.' },
  { symbol: 'DASH', name: 'DoorDash Inc.' },
  { symbol: 'ROKU', name: 'Roku Inc.' },
  { symbol: 'DDOG', name: 'Datadog Inc.' },
  { symbol: 'NET', name: 'Cloudflare Inc.' },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings Inc.' },
  { symbol: 'PANW', name: 'Palo Alto Networks' },
  { symbol: 'ZS', name: 'Zscaler Inc.' },
  { symbol: 'OKTA', name: 'Okta Inc.' },
  { symbol: 'MDB', name: 'MongoDB Inc.' },
  { symbol: 'TEAM', name: 'Atlassian Corporation' },
  { symbol: 'ZM', name: 'Zoom Video Communications' },
  { symbol: 'DOCU', name: 'DocuSign Inc.' },
  { symbol: 'TWLO', name: 'Twilio Inc.' },
  { symbol: 'SMCI', name: 'Super Micro Computer Inc.' },
  { symbol: 'ARM', name: 'Arm Holdings plc' },
  { symbol: 'MRVL', name: 'Marvell Technology Inc.' },
  { symbol: 'ASML', name: 'ASML Holding' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor' },

  // Financials
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
  { symbol: 'BAC', name: 'Bank of America Corp.' },
  { symbol: 'WFC', name: 'Wells Fargo & Co.' },
  { symbol: 'C', name: 'Citigroup Inc.' },
  { symbol: 'GS', name: 'Goldman Sachs Group Inc.' },
  { symbol: 'MS', name: 'Morgan Stanley' },
  { symbol: 'BLK', name: 'BlackRock Inc.' },
  { symbol: 'SCHW', name: 'Charles Schwab Corporation' },
  { symbol: 'AXP', name: 'American Express Co.' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'MA', name: 'Mastercard Inc.' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc. Class B' },

  // Healthcare
  { symbol: 'UNH', name: 'UnitedHealth Group Inc.' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.' },
  { symbol: 'ABBV', name: 'AbbVie Inc.' },
  { symbol: 'MRK', name: 'Merck & Co. Inc.' },
  { symbol: 'PFE', name: 'Pfizer Inc.' },
  { symbol: 'TMO', name: 'Thermo Fisher Scientific Inc.' },
  { symbol: 'ABT', name: 'Abbott Laboratories' },
  { symbol: 'DHR', name: 'Danaher Corporation' },
  { symbol: 'BMY', name: 'Bristol-Myers Squibb Co.' },
  { symbol: 'AMGN', name: 'Amgen Inc.' },
  { symbol: 'GILD', name: 'Gilead Sciences Inc.' },
  { symbol: 'CVS', name: 'CVS Health Corporation' },
  { symbol: 'MRNA', name: 'Moderna Inc.' },
  { symbol: 'BNTX', name: 'BioNTech SE' },

  // Consumer
  { symbol: 'WMT', name: 'Walmart Inc.' },
  { symbol: 'COST', name: 'Costco Wholesale Corporation' },
  { symbol: 'HD', name: 'Home Depot Inc.' },
  { symbol: 'LOW', name: "Lowe's Companies Inc." },
  { symbol: 'TGT', name: 'Target Corporation' },
  { symbol: 'NKE', name: 'Nike Inc.' },
  { symbol: 'MCD', name: "McDonald's Corporation" },
  { symbol: 'SBUX', name: 'Starbucks Corporation' },
  { symbol: 'KO', name: 'Coca-Cola Co.' },
  { symbol: 'PEP', name: 'PepsiCo Inc.' },
  { symbol: 'PG', name: 'Procter & Gamble Co.' },
  { symbol: 'DIS', name: 'Walt Disney Co.' },
  { symbol: 'CMCSA', name: 'Comcast Corporation' },
  { symbol: 'T', name: 'AT&T Inc.' },
  { symbol: 'VZ', name: 'Verizon Communications' },
  { symbol: 'LULU', name: 'Lululemon Athletica Inc.' },
  { symbol: 'CMG', name: 'Chipotle Mexican Grill Inc.' },
  { symbol: 'BKNG', name: 'Booking Holdings Inc.' },
  { symbol: 'MAR', name: 'Marriott International' },
  { symbol: 'F', name: 'Ford Motor Co.' },
  { symbol: 'GM', name: 'General Motors Co.' },
  { symbol: 'RIVN', name: 'Rivian Automotive Inc.' },
  { symbol: 'LCID', name: 'Lucid Group Inc.' },
  { symbol: 'NIO', name: 'NIO Inc.' },
  { symbol: 'BABA', name: 'Alibaba Group Holding' },
  { symbol: 'JD', name: 'JD.com Inc.' },
  { symbol: 'PDD', name: 'PDD Holdings Inc.' },

  // Energy / Industrials / Materials
  { symbol: 'XOM', name: 'Exxon Mobil Corporation' },
  { symbol: 'CVX', name: 'Chevron Corporation' },
  { symbol: 'COP', name: 'ConocoPhillips' },
  { symbol: 'SLB', name: 'Schlumberger Ltd.' },
  { symbol: 'OXY', name: 'Occidental Petroleum Corp.' },
  { symbol: 'MPC', name: 'Marathon Petroleum Corp.' },
  { symbol: 'CAT', name: 'Caterpillar Inc.' },
  { symbol: 'DE', name: 'Deere & Co.' },
  { symbol: 'BA', name: 'Boeing Co.' },
  { symbol: 'LMT', name: 'Lockheed Martin Corp.' },
  { symbol: 'RTX', name: 'RTX Corporation' },
  { symbol: 'GE', name: 'General Electric Co.' },
  { symbol: 'HON', name: 'Honeywell International' },
  { symbol: 'UPS', name: 'United Parcel Service' },
  { symbol: 'FDX', name: 'FedEx Corporation' },
  { symbol: 'UNP', name: 'Union Pacific Corporation' },
  { symbol: 'LIN', name: 'Linde plc' },
  { symbol: 'FCX', name: 'Freeport-McMoRan Inc.' },
  { symbol: 'NEM', name: 'Newmont Corporation' },
  { symbol: 'NEE', name: 'NextEra Energy Inc.' },
  { symbol: 'DUK', name: 'Duke Energy Corp.' },
  { symbol: 'SO', name: 'Southern Co.' },

  // Real Estate
  { symbol: 'PLD', name: 'Prologis Inc.' },
  { symbol: 'AMT', name: 'American Tower Corp.' },
  { symbol: 'CCI', name: 'Crown Castle Inc.' },
  { symbol: 'EQIX', name: 'Equinix Inc.' },
  { symbol: 'SPG', name: 'Simon Property Group' },
  { symbol: 'O', name: 'Realty Income Corp.' },

  // Broad-market ETFs
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF' },
  { symbol: 'IVV', name: 'iShares Core S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF' },
  { symbol: 'EFA', name: 'iShares MSCI EAFE ETF' },
  { symbol: 'EEM', name: 'iShares MSCI Emerging Markets ETF' },
  { symbol: 'VEA', name: 'Vanguard FTSE Developed Markets ETF' },
  { symbol: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF' },
  { symbol: 'FXI', name: 'iShares China Large-Cap ETF' },
  { symbol: 'EWZ', name: 'iShares MSCI Brazil ETF' },
  { symbol: 'EWJ', name: 'iShares MSCI Japan ETF' },
  { symbol: 'INDA', name: 'iShares MSCI India ETF' },

  // Sector ETFs
  { symbol: 'XLK', name: 'Technology Select Sector SPDR' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR' },
  { symbol: 'XLV', name: 'Health Care Select Sector SPDR' },
  { symbol: 'XLY', name: 'Consumer Discretionary Select Sector SPDR' },
  { symbol: 'XLP', name: 'Consumer Staples Select Sector SPDR' },
  { symbol: 'XLI', name: 'Industrial Select Sector SPDR' },
  { symbol: 'XLU', name: 'Utilities Select Sector SPDR' },
  { symbol: 'XLB', name: 'Materials Select Sector SPDR' },
  { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR' },
  { symbol: 'XLC', name: 'Communication Services Select Sector SPDR' },
  { symbol: 'SMH', name: 'VanEck Semiconductor ETF' },
  { symbol: 'SOXX', name: 'iShares Semiconductor ETF' },
  { symbol: 'IBB', name: 'iShares Biotechnology ETF' },
  { symbol: 'XBI', name: 'SPDR S&P Biotech ETF' },
  { symbol: 'XOP', name: 'SPDR S&P Oil & Gas Exploration ETF' },
  { symbol: 'KRE', name: 'SPDR S&P Regional Banking ETF' },
  { symbol: 'XRT', name: 'SPDR S&P Retail ETF' },
  { symbol: 'ITB', name: 'iShares U.S. Home Construction ETF' },
  { symbol: 'KWEB', name: 'KraneShares CSI China Internet ETF' },
  { symbol: 'ARKK', name: 'ARK Innovation ETF' },

  // Fixed income / rates
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF' },
  { symbol: 'IEF', name: 'iShares 7-10 Year Treasury Bond ETF' },
  { symbol: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF' },
  { symbol: 'LQD', name: 'iShares iBoxx $ Investment Grade Corporate Bond ETF' },
  { symbol: 'HYG', name: 'iShares iBoxx $ High Yield Corporate Bond ETF' },
  { symbol: 'TBT', name: 'ProShares UltraShort 20+ Year Treasury' },

  // Commodities / Currency
  { symbol: 'GLD', name: 'SPDR Gold Shares' },
  { symbol: 'IAU', name: 'iShares Gold Trust' },
  { symbol: 'SLV', name: 'iShares Silver Trust' },
  { symbol: 'USO', name: 'United States Oil Fund' },
  { symbol: 'UNG', name: 'United States Natural Gas Fund' },
  { symbol: 'DBC', name: 'Invesco DB Commodity Index Tracking Fund' },
  { symbol: 'UUP', name: 'Invesco DB US Dollar Index Bullish Fund' },

  // Volatility
  { symbol: 'VXX', name: 'iPath Series B S&P 500 VIX Short-Term Futures ETN' },
  { symbol: 'UVXY', name: 'ProShares Ultra VIX Short-Term Futures ETF' },
  { symbol: 'SVXY', name: 'ProShares Short VIX Short-Term Futures ETF' },

  // Leveraged / Inverse (popular with options traders)
  { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ (3x)' },
  { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ (-3x)' },
  { symbol: 'SPXL', name: 'Direxion Daily S&P 500 Bull 3X Shares' },
  { symbol: 'SPXS', name: 'Direxion Daily S&P 500 Bear 3X Shares' },
  { symbol: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3X Shares' },
  { symbol: 'SOXS', name: 'Direxion Daily Semiconductor Bear 3X Shares' },
  { symbol: 'TSLL', name: 'Direxion Daily TSLA Bull 1.5X Shares' },
  { symbol: 'NVDL', name: 'GraniteShares 2x Long NVDA Daily ETF' },

  // Crypto-adjacent (ETFs with listed options — crypto exposure via equities)
  { symbol: 'IBIT', name: 'iShares Bitcoin Trust ETF' },
  { symbol: 'FBTC', name: 'Fidelity Wise Origin Bitcoin Fund' },
  { symbol: 'GBTC', name: 'Grayscale Bitcoin Trust ETF' },
  { symbol: 'ARKB', name: 'ARK 21Shares Bitcoin ETF' },
  { symbol: 'BITB', name: 'Bitwise Bitcoin ETF' },
  { symbol: 'ETHA', name: 'iShares Ethereum Trust' },
  { symbol: 'ETHE', name: 'Grayscale Ethereum Trust ETF' },
  { symbol: 'FETH', name: 'Fidelity Ethereum Fund' },
  { symbol: 'MSTR', name: 'MicroStrategy Inc.' },
  { symbol: 'MARA', name: 'Marathon Digital Holdings Inc.' },
  { symbol: 'RIOT', name: 'Riot Platforms Inc.' },
  { symbol: 'CLSK', name: 'CleanSpark Inc.' },

  // Other high-volume optionable
  { symbol: 'GME', name: 'GameStop Corp.' },
  { symbol: 'AMC', name: 'AMC Entertainment Holdings' },
  { symbol: 'BB', name: 'BlackBerry Ltd.' },
  { symbol: 'NOK', name: 'Nokia Corporation' },
  { symbol: 'SOFI', name: 'SoFi Technologies Inc.' },
  { symbol: 'NKLA', name: 'Nikola Corporation' },
  { symbol: 'CHWY', name: 'Chewy Inc.' },
  { symbol: 'CRSP', name: 'CRISPR Therapeutics AG' },
  { symbol: 'BYND', name: 'Beyond Meat Inc.' },
  { symbol: 'PTON', name: 'Peloton Interactive Inc.' },
];

const RECENT_SYMBOLS_KEY = 'hl-options-recent-symbols';
const MAX_RECENTS = 10;

function storageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

export function getRecentSymbols(): string[] {
  if (!storageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SYMBOLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function addRecentSymbol(symbol: string): string[] {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return getRecentSymbols();
  const current = getRecentSymbols().filter((s) => s !== upper);
  const next = [upper, ...current].slice(0, MAX_RECENTS);
  if (storageAvailable()) {
    try {
      window.localStorage.setItem(RECENT_SYMBOLS_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / privacy-mode errors
    }
  }
  return next;
}

export function clearRecentSymbols(): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.removeItem(RECENT_SYMBOLS_KEY);
  } catch {
    // ignore
  }
}

export function searchPopularSymbols(query: string, limit = 10): SymbolHit[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const prefix: PopularSymbol[] = [];
  const substring: PopularSymbol[] = [];
  const nameMatch: PopularSymbol[] = [];
  for (const entry of POPULAR_SYMBOLS) {
    if (entry.symbol === q) {
      prefix.unshift(entry);
      continue;
    }
    if (entry.symbol.startsWith(q)) {
      prefix.push(entry);
    } else if (entry.symbol.includes(q)) {
      substring.push(entry);
    } else if (entry.name.toUpperCase().includes(q)) {
      nameMatch.push(entry);
    }
  }
  const merged = [...prefix, ...substring, ...nameMatch].slice(0, limit);
  return merged.map((e) => ({ symbol: e.symbol, name: e.name }));
}

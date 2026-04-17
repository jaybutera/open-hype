import type {
  OptionChain,
  OptionContract,
  OptionType,
  OptionsAdapter,
  SymbolHit,
} from './types';

interface YahooOptionRaw {
  contractSymbol: string;
  strike: number;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  expiration: number;
  inTheMoney?: boolean;
}

interface YahooOptionsGroup {
  expirationDate: number;
  calls: YahooOptionRaw[];
  puts: YahooOptionRaw[];
}

interface YahooQuote {
  regularMarketPrice?: number;
  bid?: number;
  ask?: number;
  regularMarketTime?: number;
}

interface YahooResult {
  underlyingSymbol: string;
  expirationDates: number[];
  strikes: number[];
  quote: YahooQuote;
  options: YahooOptionsGroup[];
}

export interface YahooChainResponse {
  optionChain: {
    result: YahooResult[];
    error?: unknown;
  };
}

function toContract(raw: YahooOptionRaw, underlying: string, type: OptionType): OptionContract {
  return {
    symbol: raw.contractSymbol,
    underlying,
    type,
    strike: raw.strike,
    expiration: raw.expiration,
    bid: raw.bid ?? 0,
    ask: raw.ask ?? 0,
    last: raw.lastPrice ?? 0,
    iv: raw.impliedVolatility ?? 0,
    volume: raw.volume ?? 0,
    openInterest: raw.openInterest ?? 0,
    inTheMoney: raw.inTheMoney ?? false,
  };
}

export function parseYahooChain(resp: YahooChainResponse): OptionChain {
  const result = resp?.optionChain?.result?.[0];
  if (!result) {
    throw new Error('Yahoo response missing optionChain.result');
  }
  const group = result.options?.[0];
  if (!group) {
    throw new Error('Yahoo response missing options group');
  }
  const underlying = result.underlyingSymbol;
  const price = result.quote.regularMarketPrice ?? 0;
  return {
    underlying,
    underlyingPrice: price,
    underlyingBid: result.quote.bid,
    underlyingAsk: result.quote.ask,
    expirations: [...result.expirationDates].sort((a, b) => a - b),
    strikes: [...result.strikes].sort((a, b) => a - b),
    calls: group.calls.map((c) => toContract(c, underlying, 'call')),
    puts: group.puts.map((p) => toContract(p, underlying, 'put')),
    loadedExpiration: group.expirationDate,
    asOf: result.quote.regularMarketTime ?? Math.floor(Date.now() / 1000),
  };
}

export class YahooOptionsAdapter implements OptionsAdapter {
  readonly id = 'yahoo' as const;

  async getChain(symbol: string, expiration?: number): Promise<OptionChain> {
    const upper = symbol.trim().toUpperCase();
    if (!upper) throw new Error('symbol required');
    const url = expiration
      ? `/api/options/${encodeURIComponent(upper)}?date=${expiration}`
      : `/api/options/${encodeURIComponent(upper)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Yahoo chain fetch failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as YahooChainResponse;
    return parseYahooChain(json);
  }

  async searchSymbols(query: string): Promise<SymbolHit[]> {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    return [{ symbol: q }];
  }
}

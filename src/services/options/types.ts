export type OptionType = 'call' | 'put';

export interface OptionContract {
  symbol: string;
  underlying: string;
  type: OptionType;
  strike: number;
  expiration: number;
  bid: number;
  ask: number;
  last: number;
  iv: number;
  volume: number;
  openInterest: number;
  inTheMoney: boolean;
}

export interface OptionChain {
  underlying: string;
  underlyingPrice: number;
  underlyingBid?: number;
  underlyingAsk?: number;
  expirations: number[];
  strikes: number[];
  calls: OptionContract[];
  puts: OptionContract[];
  loadedExpiration: number;
  asOf: number;
}

export interface SymbolHit {
  symbol: string;
  name?: string;
}

export interface OptionsAdapter {
  id: 'yahoo' | 'deribit' | 'tradier';
  getChain(symbol: string, expiration?: number): Promise<OptionChain>;
  searchSymbols(query: string): Promise<SymbolHit[]>;
}

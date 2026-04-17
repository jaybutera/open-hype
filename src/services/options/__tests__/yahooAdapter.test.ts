import { describe, it, expect } from 'vitest';
import { parseYahooChain, type YahooChainResponse } from '../yahooAdapter';
import fixture from '../__fixtures__/tsla_chain.json';

const resp = fixture as unknown as YahooChainResponse;

describe('parseYahooChain (TSLA fixture)', () => {
  const chain = parseYahooChain(resp);

  it('pulls underlying metadata', () => {
    expect(chain.underlying).toBe('TSLA');
    expect(chain.underlyingPrice).toBe(406.41);
    expect(chain.underlyingBid).toBe(405.96);
    expect(chain.underlyingAsk).toBe(407.03);
    expect(chain.asOf).toBe(1776441325);
  });

  it('loads 22 expirations sorted ascending', () => {
    expect(chain.expirations.length).toBe(22);
    for (let i = 1; i < chain.expirations.length; i++) {
      expect(chain.expirations[i]).toBeGreaterThan(chain.expirations[i - 1]);
    }
    expect(chain.expirations[0]).toBe(1776384000);
  });

  it('loads 194 strikes sorted ascending', () => {
    expect(chain.strikes.length).toBe(194);
    for (let i = 1; i < chain.strikes.length; i++) {
      expect(chain.strikes[i]).toBeGreaterThan(chain.strikes[i - 1]);
    }
  });

  it('parses calls and puts for the loaded expiration', () => {
    expect(chain.loadedExpiration).toBe(1776384000);
    expect(chain.calls.length).toBe(183);
    expect(chain.puts.length).toBe(188);
    for (const c of chain.calls) expect(c.type).toBe('call');
    for (const p of chain.puts) expect(p.type).toBe('put');
  });

  it('normalizes a deep-ITM call', () => {
    const itm = chain.calls.find((c) => c.symbol === 'TSLA260417C00005000');
    expect(itm).toBeDefined();
    expect(itm!.underlying).toBe('TSLA');
    expect(itm!.strike).toBe(5);
    expect(itm!.expiration).toBe(1776384000);
    expect(itm!.bid).toBe(400.35);
    expect(itm!.ask).toBe(401.8);
    expect(itm!.last).toBe(389.22);
    expect(itm!.openInterest).toBe(3269);
    expect(itm!.volume).toBe(2);
    expect(itm!.inTheMoney).toBe(true);
    expect(itm!.iv).toBeGreaterThan(0);
  });

  it('keeps IV as decimal for a near-ATM contract', () => {
    const atm = chain.calls.find((c) => c.strike === 407.5);
    expect(atm).toBeDefined();
    expect(atm!.iv).toBeGreaterThan(0.1);
    expect(atm!.iv).toBeLessThan(1.0);
  });

  it('defaults missing numeric fields to 0 without throwing', () => {
    for (const c of chain.calls) {
      expect(Number.isFinite(c.volume)).toBe(true);
      expect(Number.isFinite(c.openInterest)).toBe(true);
      expect(Number.isFinite(c.bid)).toBe(true);
      expect(Number.isFinite(c.ask)).toBe(true);
    }
  });

  it('distinguishes ITM calls from OTM by strike vs underlying', () => {
    for (const c of chain.calls) {
      if (c.strike < chain.underlyingPrice) {
        expect(c.inTheMoney).toBe(true);
      }
    }
    for (const p of chain.puts) {
      if (p.strike > chain.underlyingPrice) {
        expect(p.inTheMoney).toBe(true);
      }
    }
  });

  it('throws on malformed response', () => {
    expect(() => parseYahooChain({ optionChain: { result: [] } } as YahooChainResponse)).toThrow();
    expect(() =>
      parseYahooChain({
        optionChain: { result: [{ underlyingSymbol: 'X', expirationDates: [], strikes: [], quote: {}, options: [] }] },
      } as unknown as YahooChainResponse),
    ).toThrow();
  });
});

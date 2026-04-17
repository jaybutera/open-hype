import { describe, it, expect } from 'vitest';
import { blackScholes, normCdf, normPdf, yearsUntil, SECONDS_PER_YEAR } from '../greeks';
import { parseYahooChain, type YahooChainResponse } from '../yahooAdapter';
import fixture from '../__fixtures__/tsla_chain.json';

const approx = (actual: number, expected: number, tol: number) => {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
};

describe('normCdf / normPdf', () => {
  it('normCdf boundary values', () => {
    approx(normCdf(0), 0.5, 1e-6);
    approx(normCdf(-1.96), 0.025, 1e-3);
    approx(normCdf(1.96), 0.975, 1e-3);
    approx(normCdf(-10), 0, 1e-6);
    approx(normCdf(10), 1, 1e-6);
  });

  it('normPdf peak at zero', () => {
    approx(normPdf(0), 1 / Math.sqrt(2 * Math.PI), 1e-9);
    approx(normPdf(1), 0.24197, 1e-4);
  });
});

describe('yearsUntil', () => {
  it('converts seconds to years', () => {
    const now = 1_000_000_000;
    approx(yearsUntil(now + SECONDS_PER_YEAR, now), 1, 1e-9);
    approx(yearsUntil(now + SECONDS_PER_YEAR / 2, now), 0.5, 1e-9);
  });
  it('clamps to zero for expired', () => {
    expect(yearsUntil(1000, 2000)).toBe(0);
  });
});

describe('blackScholes — canonical textbook case (Hull)', () => {
  // Hull, Options Futures & Other Derivatives — stock price 42, strike 40,
  // r=0.10, sigma=0.20, T=0.5. Call = 4.759, Put = 0.808.
  const base = {
    underlyingPrice: 42,
    strike: 40,
    timeToExpiry: 0.5,
    volatility: 0.2,
    riskFreeRate: 0.1,
  } as const;

  it('call price matches Hull', () => {
    const g = blackScholes({ ...base, type: 'call' });
    approx(g.price, 4.759, 0.01);
  });

  it('put price matches Hull', () => {
    const g = blackScholes({ ...base, type: 'put' });
    approx(g.price, 0.808, 0.01);
  });

  it('put-call parity: C - P = S - K*exp(-rT)', () => {
    const c = blackScholes({ ...base, type: 'call' }).price;
    const p = blackScholes({ ...base, type: 'put' }).price;
    const parity = base.underlyingPrice - base.strike * Math.exp(-base.riskFreeRate * base.timeToExpiry);
    approx(c - p, parity, 1e-6);
  });

  it('call delta and put delta differ by 1', () => {
    const cd = blackScholes({ ...base, type: 'call' }).delta;
    const pd = blackScholes({ ...base, type: 'put' }).delta;
    approx(cd - pd, 1, 1e-9);
  });

  it('gamma equal for call and put', () => {
    const cg = blackScholes({ ...base, type: 'call' }).gamma;
    const pg = blackScholes({ ...base, type: 'put' }).gamma;
    approx(cg, pg, 1e-9);
  });

  it('vega equal for call and put', () => {
    const cv = blackScholes({ ...base, type: 'call' }).vega;
    const pv = blackScholes({ ...base, type: 'put' }).vega;
    approx(cv, pv, 1e-9);
  });
});

describe('blackScholes — ATM behavior', () => {
  it('ATM call delta ~0.5', () => {
    const g = blackScholes({
      underlyingPrice: 100,
      strike: 100,
      timeToExpiry: 0.25,
      volatility: 0.3,
      type: 'call',
      riskFreeRate: 0,
    });
    approx(g.delta, 0.5, 0.03);
  });

  it('ATM put delta ~-0.5', () => {
    const g = blackScholes({
      underlyingPrice: 100,
      strike: 100,
      timeToExpiry: 0.25,
      volatility: 0.3,
      type: 'put',
      riskFreeRate: 0,
    });
    approx(g.delta, -0.5, 0.03);
  });
});

describe('blackScholes — degenerate inputs', () => {
  it('T=0 call returns intrinsic', () => {
    const g = blackScholes({
      underlyingPrice: 110,
      strike: 100,
      timeToExpiry: 0,
      volatility: 0.3,
      type: 'call',
    });
    expect(g.price).toBe(10);
    expect(g.delta).toBe(1);
    expect(g.gamma).toBe(0);
  });

  it('T=0 OTM put returns 0', () => {
    const g = blackScholes({
      underlyingPrice: 110,
      strike: 100,
      timeToExpiry: 0,
      volatility: 0.3,
      type: 'put',
    });
    expect(g.price).toBe(0);
    expect(g.delta).toBe(0);
  });

  it('sigma=0 returns intrinsic-like price', () => {
    const g = blackScholes({
      underlyingPrice: 110,
      strike: 100,
      timeToExpiry: 0.5,
      volatility: 0,
      type: 'call',
    });
    expect(g.gamma).toBe(0);
    expect(g.vega).toBe(0);
  });
});

describe('blackScholes — TSLA fixture sanity', () => {
  const chain = parseYahooChain(fixture as unknown as YahooChainResponse);
  const S = chain.underlyingPrice;
  // Fixture was captured on the loaded expiration day, so T~0 for the first
  // expiration. Project to a 30-day horizon for meaningful Greeks.
  const asOf = chain.asOf;
  const horizon = asOf + 30 * 24 * 3600;

  it('ATM call has delta ~0.5 with positive gamma/vega and negative theta', () => {
    const atmCall = chain.calls
      .slice()
      .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0];
    const T = yearsUntil(horizon, asOf);
    const g = blackScholes({
      underlyingPrice: S,
      strike: atmCall.strike,
      timeToExpiry: T,
      volatility: atmCall.iv,
      type: 'call',
    });
    expect(g.delta).toBeGreaterThan(0.3);
    expect(g.delta).toBeLessThan(0.7);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
  });

  it('ATM put has delta ~-0.5', () => {
    const atmPut = chain.puts
      .slice()
      .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0];
    const T = yearsUntil(horizon, asOf);
    const g = blackScholes({
      underlyingPrice: S,
      strike: atmPut.strike,
      timeToExpiry: T,
      volatility: atmPut.iv,
      type: 'put',
    });
    expect(g.delta).toBeLessThan(-0.3);
    expect(g.delta).toBeGreaterThan(-0.7);
  });
});

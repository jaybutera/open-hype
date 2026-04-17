import { describe, it, expect } from 'vitest';
import { parseOccSymbol, formatContractLabel } from '../occSymbol';

describe('parseOccSymbol', () => {
  it('parses standard OCC symbol (TSLA 2026-04-17 C $300)', () => {
    const p = parseOccSymbol('TSLA260417C00300000');
    expect(p).not.toBeNull();
    expect(p!.underlying).toBe('TSLA');
    expect(p!.type).toBe('call');
    expect(p!.strike).toBe(300);
    // UTC midnight of 2026-04-17
    expect(p!.expiration).toBe(Math.floor(Date.UTC(2026, 3, 17) / 1000));
  });

  it('parses put symbol', () => {
    const p = parseOccSymbol('AAPL261219P00175000');
    expect(p).not.toBeNull();
    expect(p!.underlying).toBe('AAPL');
    expect(p!.type).toBe('put');
    expect(p!.strike).toBe(175);
  });

  it('handles fractional strike with trailing zeros (TSLA $27.50)', () => {
    const p = parseOccSymbol('TSLA260417C00027500');
    expect(p!.strike).toBe(27.5);
  });

  it('handles 1-letter and 5-letter underlying tickers', () => {
    expect(parseOccSymbol('F260417C00012000')!.underlying).toBe('F');
    expect(parseOccSymbol('GOOGL260417C00150000')!.underlying).toBe('GOOGL');
  });

  it('handles sub-dollar strikes (SIRI $6)', () => {
    const p = parseOccSymbol('SIRI260417C00006000');
    expect(p!.strike).toBe(6);
  });

  it('returns null for malformed symbols', () => {
    expect(parseOccSymbol('')).toBeNull();
    expect(parseOccSymbol('TSLA')).toBeNull();
    expect(parseOccSymbol('TSLA260417X00300000')).toBeNull(); // not C/P
    expect(parseOccSymbol('TSLA261317C00300000')).toBeNull(); // month 13
    expect(parseOccSymbol('TSLA260400C00300000')).toBeNull(); // day 0
    expect(parseOccSymbol('260417C00300000')).toBeNull(); // no underlying
  });

  it('rejects lowercase underlying', () => {
    expect(parseOccSymbol('tsla260417C00300000')).toBeNull();
  });
});

describe('formatContractLabel', () => {
  it('formats whole-dollar strike call', () => {
    expect(formatContractLabel('TSLA260417C00300000')).toBe('TSLA 4/17 $300 C');
  });

  it('formats put', () => {
    expect(formatContractLabel('AAPL261219P00175000')).toBe('AAPL 12/19 $175 P');
  });

  it('formats fractional strike without trailing zeros', () => {
    expect(formatContractLabel('TSLA260417C00027500')).toBe('TSLA 4/17 $27.5 C');
  });

  it('falls back to raw symbol when unparseable', () => {
    expect(formatContractLabel('not-an-occ-symbol')).toBe('not-an-occ-symbol');
    expect(formatContractLabel('BTC-PERP')).toBe('BTC-PERP');
  });
});

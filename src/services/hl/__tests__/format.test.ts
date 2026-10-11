import { describe, it, expect } from 'vitest';
import { formatPrice, formatSize, toWire } from '../format.ts';

describe('wire formatting (docs: tick and lot size)', () => {
  it('strips trailing zeros and negative zero', () => {
    expect(toWire('100.000')).toBe('100');
    expect(toWire('0.0147000')).toBe('0.0147');
    expect(toWire('-0')).toBe('0');
    expect(toWire(1e-7)).toBe('0.0000001');
  });

  it('prices: 5 significant figures, max 6 - szDecimals decimals, integers always allowed', () => {
    expect(formatPrice('1234.56', 1)).toBe('1234.6');
    expect(formatPrice('0.0012345678', 0)).toBe('0.001235');
    expect(formatPrice('0.0012345678', 2)).toBe('0.0012');
    expect(formatPrice('123456.7', 5)).toBe('123457');
    expect(formatPrice('64000.123', 5)).toBe('64000');
    expect(formatPrice(63_999.99, 5)).toBe('64000');
  });

  it('sizes round down to the lot so risk is never exceeded', () => {
    expect(formatSize('0.0012399', 5)).toBe('0.00123');
    expect(formatSize('12.999', 0)).toBe('12');
    expect(formatSize(0.1 + 0.2, 4)).toBe('0.3');
  });

  it('rejects non-positive and non-finite values', () => {
    expect(() => formatPrice('0', 2)).toThrow();
    expect(() => formatSize('-1', 2)).toThrow();
    expect(() => formatPrice(NaN, 2)).toThrow();
  });
});

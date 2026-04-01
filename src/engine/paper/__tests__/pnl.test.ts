import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { calculateFee, calculateRoe } from '../pnl.ts';
import { MAKER_FEE_RATE, TAKER_FEE_RATE } from '../../../config/constants.ts';

describe('calculateFee', () => {
  it('calculates maker fee (0.015%)', () => {
    const fee = calculateFee(new Decimal('1'), new Decimal('50000'), true, MAKER_FEE_RATE, TAKER_FEE_RATE);
    // 1 * 50000 * 0.00015 = 7.5
    expect(fee.toString()).toBe('7.5');
  });

  it('calculates taker fee (0.045%)', () => {
    const fee = calculateFee(new Decimal('1'), new Decimal('50000'), false, MAKER_FEE_RATE, TAKER_FEE_RATE);
    // 1 * 50000 * 0.00045 = 22.5
    expect(fee.toString()).toBe('22.5');
  });

  it('scales with size', () => {
    const fee = calculateFee(new Decimal('0.5'), new Decimal('50000'), true, MAKER_FEE_RATE, TAKER_FEE_RATE);
    expect(fee.toString()).toBe('3.75');
  });

  it('uses custom fee rates', () => {
    const fee = calculateFee(new Decimal('1'), new Decimal('50000'), true, '0.0001', '0.00035');
    // 1 * 50000 * 0.0001 = 5
    expect(fee.toString()).toBe('5');
  });
});

describe('calculateRoe', () => {
  it('returns positive ROE for profit', () => {
    const roe = calculateRoe(new Decimal('1000'), new Decimal('5000'));
    expect(roe.toString()).toBe('0.2'); // 20%
  });

  it('returns negative ROE for loss', () => {
    const roe = calculateRoe(new Decimal('-500'), new Decimal('5000'));
    expect(roe.toString()).toBe('-0.1'); // -10%
  });

  it('returns zero for zero margin', () => {
    const roe = calculateRoe(new Decimal('1000'), new Decimal('0'));
    expect(roe.toString()).toBe('0');
  });
});

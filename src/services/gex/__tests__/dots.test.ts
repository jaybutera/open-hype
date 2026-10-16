import { describe, expect, it } from 'vitest';
import { dotRadius, DOT_ALPHA } from '../../../components/chart/GexPrimitive.ts';

describe('dotRadius', () => {
  it('is narrower than the bar and absent on thin bars', () => {
    expect(dotRadius(14)).toBe(3.5);
    expect(dotRadius(10)).toBe(3);
    expect(dotRadius(6)).toBe(1);
    expect(dotRadius(4)).toBe(0);
    for (const h of [5, 8, 14, 20]) expect(dotRadius(h) * 2).toBeLessThan(h);
  });
  it('shorter lookback is the brighter dot', () => {
    expect(DOT_ALPHA[0]).toBeGreaterThan(DOT_ALPHA[1]);
  });
});

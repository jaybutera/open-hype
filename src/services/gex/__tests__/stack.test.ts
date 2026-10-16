import { describe, it, expect } from 'vitest';
import { stackLayout } from '../../../components/chart/GexPrimitive.ts';

describe('stackLayout', () => {
  it('shrinks the current bar so two past rows fit in the strike row', () => {
    expect(stackLayout(20, 2)).toEqual({ barH: 9, pastH: 4 });
    expect(stackLayout(40, 2)).toEqual({ barH: 14, pastH: 6 });
    expect(stackLayout(10, 2)).toEqual({ barH: 3, pastH: 2 });
  });
  it('drops the past rows when strikes are too close', () => {
    expect(stackLayout(8, 2)).toEqual({ barH: 7, pastH: 0 });
    expect(stackLayout(9, 2)).toEqual({ barH: 8, pastH: 0 });
  });
  it('keeps the old height without past rows', () => {
    expect(stackLayout(20, 0)).toEqual({ barH: 14, pastH: 0 });
  });
});

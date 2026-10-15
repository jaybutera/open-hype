import { describe, it, expect } from 'vitest';
import {
  validateAlert, crossSatisfied, closeSatisfied, sameCondition, describeAlert, alertLine,
  AlertValidationError,
} from '../alerts.ts';

const ctx = { id: 'al_1', defaultAsset: 'BTC', mid: 83175, now: 1_000 };

describe('validateAlert', () => {
  it('defaults kind to cross, asset to the chart, direction from the mid', () => {
    const a = validateAlert({ level: 84315 }, ctx);
    expect(a).toMatchObject({ id: 'al_1', asset: 'BTC', kind: 'cross', direction: 'above', level: 84315, status: 'armed', refPrice: 83175, createdAt: 1_000, source: 'mcp' });
    expect(validateAlert({ level: 82927 }, ctx).direction).toBe('below');
  });

  it('rejects a cross level already past the mid unless forced', () => {
    expect(() => validateAlert({ level: 82000, direction: 'above' }, ctx)).toThrow(AlertValidationError);
    expect(() => validateAlert({ level: 82000, direction: 'above' }, ctx)).toThrow(/already above the mid 83175/);
    expect(validateAlert({ level: 82000, direction: 'above', force: true }, ctx).status).toBe('armed');
  });

  it('refuses to arm without a current mid, so refPrice is never null', () => {
    expect(() => validateAlert({ level: 1 }, { ...ctx, mid: null })).toThrow(/no current price for BTC/);
    expect(() => validateAlert({ level: 1, direction: 'below' }, { ...ctx, mid: null })).toThrow(AlertValidationError);
  });

  it('needs an asset when there is no chart to default from', () => {
    expect(() => validateAlert({ level: 1, direction: 'above' }, { ...ctx, defaultAsset: null })).toThrow(/asset is required/);
    expect(validateAlert({ level: 90000, direction: 'above', asset: 'ETH' }, { ...ctx, defaultAsset: null }).asset).toBe('ETH');
  });

  it('close alerts need a known interval and skip the already-past check', () => {
    expect(() => validateAlert({ level: 82927, kind: 'close', direction: 'below' }, ctx)).toThrow(/close alerts need interval/);
    expect(() => validateAlert({ level: 82927, kind: 'close', direction: 'below', interval: '7m' }, ctx)).toThrow(/close alerts need interval/);
    const a = validateAlert({ level: 90000, kind: 'close', direction: 'below', interval: '15m' }, ctx);
    expect(a.interval).toBe('15m');
    // interval is dropped for cross alerts
    expect(validateAlert({ level: 84315, interval: '15m' }, ctx).interval).toBeUndefined();
  });

  it('rejects bad levels, kinds, directions and notes', () => {
    expect(() => validateAlert({ level: 0 }, ctx)).toThrow(/level must be/);
    expect(() => validateAlert({ level: 'x' }, ctx)).toThrow(/level must be/);
    expect(() => validateAlert({ level: 1, kind: 'touch' }, ctx)).toThrow(/kind must be/);
    expect(() => validateAlert({ level: 1, direction: 'up' }, ctx)).toThrow(/direction must be/);
    expect(() => validateAlert({ level: 1, note: 5 }, ctx)).toThrow(/note must be/);
    expect(() => validateAlert(null, ctx)).toThrow(/must be an object/);
  });

  it('trims and caps the note, and takes the source from the input', () => {
    const a = validateAlert({ level: 84315, note: '  ' + 'x'.repeat(400), source: 'ui' }, ctx);
    expect(a.note).toHaveLength(300);
    expect(a.source).toBe('ui');
    expect(validateAlert({ level: 84315, note: '   ' }, ctx).note).toBeUndefined();
  });
});

describe('conditions', () => {
  it('cross and close compare inclusively in the alert direction', () => {
    const up = { direction: 'above' as const, level: 100 };
    const down = { direction: 'below' as const, level: 100 };
    expect(crossSatisfied(up, 100)).toBe(true);
    expect(crossSatisfied(up, 99.9)).toBe(false);
    expect(crossSatisfied(down, 100)).toBe(true);
    expect(crossSatisfied(down, 100.1)).toBe(false);
    expect(closeSatisfied(down, 99)).toBe(true);
  });

  it('sameCondition ignores id and note but not interval', () => {
    const a = validateAlert({ level: 84315, note: 'a' }, { ...ctx, id: 'x' });
    const b = validateAlert({ level: 84315, note: 'b' }, { ...ctx, id: 'y' });
    const c = validateAlert({ level: 84315, kind: 'close', interval: '4h', direction: 'above' }, { ...ctx, id: 'z' });
    expect(sameCondition(a, b)).toBe(true);
    expect(sameCondition(a, c)).toBe(false);
  });

  it('describes and draws an alert', () => {
    const a = validateAlert({ level: 82927, kind: 'close', interval: '15m', direction: 'below' }, ctx);
    expect(describeAlert(a)).toBe('BTC 15m close ↓ 82927');
    expect(alertLine(a)).toMatchObject({ type: 'hline', price: 82927, style: 'dashed', color: '#f0b90b' });
    expect(alertLine({ ...a, status: 'fired' }).color).toBe('#f6465d');
  });
});

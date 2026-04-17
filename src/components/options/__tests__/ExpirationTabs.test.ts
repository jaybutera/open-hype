import { describe, it, expect } from 'vitest';
import { formatExpirationLabel } from '../ExpirationTabs';

describe('formatExpirationLabel', () => {
  it('formats same-day expiration as 0d (weekly close)', () => {
    // Yahoo expiration unix seconds are always 00:00 UTC of the expiry date
    // 2026-04-17 00:00 UTC
    const exp = Math.floor(Date.UTC(2026, 3, 17, 0, 0, 0) / 1000);
    // "now" is 2026-04-17 10:00 ET (14:00 UTC) — same day
    const now = new Date(Date.UTC(2026, 3, 17, 14, 0, 0));
    const { label, dte } = formatExpirationLabel(exp, now);
    expect(dte).toBe(0);
    expect(label).toMatch(/^Apr 1[67] \(0d\)$/);
  });

  it('formats future expiration with correct day count', () => {
    const exp = Math.floor(Date.UTC(2026, 4, 16, 0, 0, 0) / 1000); // May 16 2026
    const now = new Date(Date.UTC(2026, 3, 17, 14, 0, 0)); // Apr 17 2026 10:00 ET
    const { label, dte } = formatExpirationLabel(exp, now);
    expect(dte).toBeGreaterThanOrEqual(29);
    expect(dte).toBeLessThanOrEqual(30);
    expect(label).toMatch(/^May 1[56] \(\d+d\)$/);
  });

  it('floors past expirations at 0d, never negative', () => {
    const exp = Math.floor(Date.UTC(2026, 3, 10, 0, 0, 0) / 1000); // Apr 10 2026
    const now = new Date(Date.UTC(2026, 3, 17, 14, 0, 0)); // Apr 17 2026
    const { dte } = formatExpirationLabel(exp, now);
    expect(dte).toBe(0);
  });

  it('uses NY timezone for month/day formatting', () => {
    // 2026-06-19 00:00 UTC is still Jun 18 in ET; label should show Jun 18
    const exp = Math.floor(Date.UTC(2026, 5, 19, 0, 0, 0) / 1000);
    const now = new Date(Date.UTC(2026, 5, 1, 14, 0, 0));
    const { label } = formatExpirationLabel(exp, now);
    expect(label.startsWith('Jun 18')).toBe(true);
  });
});

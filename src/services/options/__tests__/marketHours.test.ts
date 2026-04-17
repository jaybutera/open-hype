import { describe, expect, it } from 'vitest';
import {
  EARLY_CLOSE_MINUTES,
  MARKET_CLOSE_MINUTES,
  MARKET_OPEN_MINUTES,
  NYSE_EARLY_CLOSE_2026,
  NYSE_HOLIDAYS_2026,
  isEarlyCloseDay,
  isHoliday,
  isMarketOpen,
  nextOpen,
} from '../marketHours';

// Build a Date that represents a specific wall-clock time in America/New_York.
// Returns the UTC instant whose NY rendering equals the given (y, m, d, h, min).
// We use the same iterative technique as openInstantForNyDate, but parameterized
// for arbitrary h/m so tests can express local times without hardcoding offsets.
function nyDate(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // Initial guess at EST (UTC-5).
  let guess = new Date(Date.UTC(y, m - 1, d, h + 5, min, 0));
  for (let i = 0; i < 4; i++) {
    const parts = fmt.formatToParts(guess);
    const lut: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') lut[p.type] = p.value;
    const py = Number(lut.year);
    const pm = Number(lut.month);
    const pd = Number(lut.day);
    const ph = Number(lut.hour) % 24;
    const pmin = Number(lut.minute);
    const targetUtc = Date.UTC(y, m - 1, d);
    const actualUtc = Date.UTC(py, pm - 1, pd);
    const dayDiffMin = ((actualUtc - targetUtc) / 86_400_000) * 1_440;
    const diff = dayDiffMin + (ph * 60 + pmin) - (h * 60 + min);
    if (diff === 0) return guess;
    guess = new Date(guess.getTime() - diff * 60_000);
  }
  return guess;
}

describe('marketHours constants', () => {
  it('09:30 and 16:00 ET expressed in minutes', () => {
    expect(MARKET_OPEN_MINUTES).toBe(570);
    expect(MARKET_CLOSE_MINUTES).toBe(960);
    expect(EARLY_CLOSE_MINUTES).toBe(780);
  });

  it('2026 NYSE holiday list covers the canonical 10 closures', () => {
    expect(NYSE_HOLIDAYS_2026).toHaveLength(10);
    expect(NYSE_HOLIDAYS_2026).toContain('2026-01-01');
    expect(NYSE_HOLIDAYS_2026).toContain('2026-07-03'); // observed for Jul 4 Sat
    expect(NYSE_HOLIDAYS_2026).toContain('2026-12-25');
  });

  it('2026 early-close list contains the known 1pm days', () => {
    expect(NYSE_EARLY_CLOSE_2026).toContain('2026-11-27');
    expect(NYSE_EARLY_CLOSE_2026).toContain('2026-12-24');
  });
});

describe('isMarketOpen', () => {
  it('open at 10:00 ET on a regular Tuesday (2026-04-14)', () => {
    expect(isMarketOpen(nyDate(2026, 4, 14, 10, 0))).toBe(true);
  });

  it('closed at 09:29 ET on a regular weekday', () => {
    expect(isMarketOpen(nyDate(2026, 4, 14, 9, 29))).toBe(false);
  });

  it('open exactly at 09:30 ET', () => {
    expect(isMarketOpen(nyDate(2026, 4, 14, 9, 30))).toBe(true);
  });

  it('closed exactly at 16:00 ET (inclusive close is closed)', () => {
    expect(isMarketOpen(nyDate(2026, 4, 14, 16, 0))).toBe(false);
  });

  it('open at 15:59 ET', () => {
    expect(isMarketOpen(nyDate(2026, 4, 14, 15, 59))).toBe(true);
  });

  it('closed on Saturday (2026-04-18)', () => {
    expect(isMarketOpen(nyDate(2026, 4, 18, 12, 0))).toBe(false);
  });

  it('closed on Sunday (2026-04-19)', () => {
    expect(isMarketOpen(nyDate(2026, 4, 19, 12, 0))).toBe(false);
  });

  it('closed on Good Friday 2026 (holiday, 2026-04-03) even during hours', () => {
    expect(isMarketOpen(nyDate(2026, 4, 3, 11, 0))).toBe(false);
    expect(isHoliday(nyDate(2026, 4, 3, 11, 0))).toBe(true);
  });

  it('closed on New Year 2026 (2026-01-01)', () => {
    expect(isMarketOpen(nyDate(2026, 1, 1, 11, 0))).toBe(false);
  });

  it('early close day closes at 13:00 ET (day after Thanksgiving)', () => {
    expect(isEarlyCloseDay(nyDate(2026, 11, 27, 10, 0))).toBe(true);
    expect(isMarketOpen(nyDate(2026, 11, 27, 12, 59))).toBe(true);
    expect(isMarketOpen(nyDate(2026, 11, 27, 13, 0))).toBe(false);
    expect(isMarketOpen(nyDate(2026, 11, 27, 15, 30))).toBe(false);
  });
});

describe('nextOpen', () => {
  it('returns now if market is currently open', () => {
    const t = nyDate(2026, 4, 14, 10, 0);
    expect(nextOpen(t).getTime()).toBe(t.getTime());
  });

  it('pre-open same day → 09:30 that day', () => {
    const t = nyDate(2026, 4, 14, 8, 0);
    const next = nextOpen(t);
    const expected = nyDate(2026, 4, 14, 9, 30);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it('after close Tuesday → 09:30 Wednesday', () => {
    const t = nyDate(2026, 4, 14, 17, 0);
    const next = nextOpen(t);
    const expected = nyDate(2026, 4, 15, 9, 30);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it('Friday 5pm → Monday 09:30', () => {
    const t = nyDate(2026, 4, 17, 17, 0);
    const next = nextOpen(t);
    const expected = nyDate(2026, 4, 20, 9, 30);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it('skips Good Friday: Thu Apr 2 after close → Mon Apr 6 09:30', () => {
    const t = nyDate(2026, 4, 2, 17, 0);
    const next = nextOpen(t);
    const expected = nyDate(2026, 4, 6, 9, 30);
    expect(next.getTime()).toBe(expected.getTime());
  });
});

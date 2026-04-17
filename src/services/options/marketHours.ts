// NYSE regular-session gate for options-paper feature.
// Uses Intl with America/New_York so DST transitions (second Sunday in March,
// first Sunday in November) are handled without hardcoding offsets.

export const MARKET_OPEN_MINUTES = 9 * 60 + 30; // 09:30 ET
export const MARKET_CLOSE_MINUTES = 16 * 60; // 16:00 ET
export const EARLY_CLOSE_MINUTES = 13 * 60; // 13:00 ET

// NYSE full-closure holidays for 2026 (observed dates).
// Source: NYSE 2026 holiday schedule.
export const NYSE_HOLIDAYS_2026: readonly string[] = [
  '2026-01-01', // New Year's Day (Thu)
  '2026-01-19', // MLK Jr. Day (Mon)
  '2026-02-16', // Presidents' Day (Mon)
  '2026-04-03', // Good Friday (Fri)
  '2026-05-25', // Memorial Day (Mon)
  '2026-06-19', // Juneteenth (Fri)
  '2026-07-03', // Independence Day observed (Jul 4 is Sat → observed Fri)
  '2026-09-07', // Labor Day (Mon)
  '2026-11-26', // Thanksgiving (Thu)
  '2026-12-25', // Christmas Day (Fri)
];

// Early-close days (1:00pm ET). Day after Thanksgiving and Christmas Eve 2026.
// Jul 3 is a full holiday in 2026, so no early-close there.
export const NYSE_EARLY_CLOSE_2026: readonly string[] = [
  '2026-11-27', // Day after Thanksgiving
  '2026-12-24', // Christmas Eve (Thu)
];

interface NyParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0=Sun..6=Sat
  minutesSinceMidnight: number;
}

const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
});

function partsInNewYork(now: Date): NyParts {
  const parts = nyFormatter.formatToParts(now);
  const lookup: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') lookup[p.type] = p.value;
  const hour = Number(lookup.hour) % 24; // Intl returns '24' at midnight on some engines
  const minute = Number(lookup.minute);
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    weekday: weekdayIndex[lookup.weekday] ?? 0,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function isoDate(p: { year: number; month: number; day: number }): string {
  const m = String(p.month).padStart(2, '0');
  const d = String(p.day).padStart(2, '0');
  return `${p.year}-${m}-${d}`;
}

export function isHoliday(now: Date = new Date()): boolean {
  const p = partsInNewYork(now);
  return NYSE_HOLIDAYS_2026.includes(isoDate(p));
}

export function isEarlyCloseDay(now: Date = new Date()): boolean {
  const p = partsInNewYork(now);
  return NYSE_EARLY_CLOSE_2026.includes(isoDate(p));
}

export function isMarketOpen(now: Date = new Date()): boolean {
  const p = partsInNewYork(now);
  if (p.weekday === 0 || p.weekday === 6) return false;
  if (NYSE_HOLIDAYS_2026.includes(isoDate(p))) return false;
  const close = NYSE_EARLY_CLOSE_2026.includes(isoDate(p))
    ? EARLY_CLOSE_MINUTES
    : MARKET_CLOSE_MINUTES;
  return (
    p.minutesSinceMidnight >= MARKET_OPEN_MINUTES &&
    p.minutesSinceMidnight < close
  );
}

// Returns the next market-open moment at or after `now`, as a Date in UTC.
// Strategy: probe forward day-by-day until we find a trading day, then build
// the 09:30 ET instant for that day by binary-searching the UTC timestamp
// that renders as 09:30 in New York (avoids hardcoding DST offsets).
export function nextOpen(now: Date = new Date()): Date {
  if (isMarketOpen(now)) return new Date(now.getTime());
  const p = partsInNewYork(now);
  const todayIso = isoDate(p);
  const todayIsTrading =
    p.weekday !== 0 &&
    p.weekday !== 6 &&
    !NYSE_HOLIDAYS_2026.includes(todayIso);
  if (todayIsTrading && p.minutesSinceMidnight < MARKET_OPEN_MINUTES) {
    return openInstantForNyDate(p.year, p.month, p.day);
  }
  // Otherwise advance to the next valid trading day.
  const start = new Date(Date.UTC(p.year, p.month - 1, p.day));
  for (let offset = 1; offset <= 10; offset++) {
    const candidate = new Date(start.getTime() + offset * 86_400_000);
    // Re-parse candidate midday in NY to get that day's NY calendar date.
    const candidateNoon = new Date(candidate.getTime() + 12 * 3_600_000);
    const cp = partsInNewYork(candidateNoon);
    if (cp.weekday === 0 || cp.weekday === 6) continue;
    if (NYSE_HOLIDAYS_2026.includes(isoDate(cp))) continue;
    return openInstantForNyDate(cp.year, cp.month, cp.day);
  }
  throw new Error('nextOpen: no trading day found within 10 days');
}

// Given a NY calendar date, return the UTC instant that corresponds to 09:30
// America/New_York on that date. Iteratively corrects a UTC guess by reading
// the time back through the Intl formatter — works across DST without hardcoding
// offsets.
function openInstantForNyDate(
  year: number,
  month: number,
  day: number,
): Date {
  // Initial guess: 09:30 EST (UTC-5). DST shifts actual value by ±1h.
  let guess = new Date(Date.UTC(year, month - 1, day, 14, 30, 0));
  for (let i = 0; i < 4; i++) {
    const p = partsInNewYork(guess);
    const targetUtc = Date.UTC(year, month - 1, day);
    const actualUtc = Date.UTC(p.year, p.month - 1, p.day);
    const dayDiffMin = ((actualUtc - targetUtc) / 86_400_000) * 1_440;
    const diff = dayDiffMin + (p.minutesSinceMidnight - MARKET_OPEN_MINUTES);
    if (diff === 0) return guess;
    guess = new Date(guess.getTime() - diff * 60_000);
  }
  return guess;
}

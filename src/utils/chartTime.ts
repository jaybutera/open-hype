/**
 * lightweight-charts displays timestamps via getUTCHours(), so the x-axis
 * always shows UTC. We want to show New York (ET) time instead.
 * Shift timestamps by the NY UTC offset so the chart "accidentally" displays ET.
 *
 * Pure (Intl only, no DOM) so the Vite AI plugin and validators can use it too.
 */
function nyOffsetSec(utcSec: number): number {
  const d = new Date(utcSec * 1000);
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d);
  const nyH = parseInt(ny.find(p => p.type === 'hour')!.value, 10) % 24;
  const nyM = parseInt(ny.find(p => p.type === 'minute')!.value, 10);
  const nySod = nyH * 3600 + nyM * 60;
  const utcSod = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60;
  let off = nySod - utcSod;
  if (off > 43200) off -= 86400;
  if (off < -43200) off += 86400;
  return off;
}

// One-hour cache window. Bounded on both sides so a lookup for an older
// timestamp (e.g. a bar before a DST switch) does not reuse a newer offset.
let _cachedOffset: number | null = null;
let _cachedOffsetStart = 0;
let _cachedOffsetExpiry = 0;
export function getNyOffset(utcSec: number): number {
  if (_cachedOffset !== null && utcSec >= _cachedOffsetStart && utcSec < _cachedOffsetExpiry) {
    return _cachedOffset;
  }
  _cachedOffset = nyOffsetSec(utcSec);
  _cachedOffsetStart = utcSec;
  _cachedOffsetExpiry = utcSec + 3600;
  return _cachedOffset;
}

/** UTC seconds -> chart time (seconds shifted so the axis reads ET). */
export function utcToChartTime(utcSec: number): number {
  return utcSec + getNyOffset(utcSec);
}

/** Chart time (ET-shifted seconds) -> UTC seconds. */
export function chartTimeToUtc(chartSec: number): number {
  return chartSec - getNyOffset(chartSec);
}

/** UTC ms -> "YYYY-MM-DD HH:MM ET". */
export function formatEt(utcMs: number): string {
  const shifted = new Date((utcToChartTime(Math.floor(utcMs / 1000))) * 1000);
  return `${shifted.toISOString().slice(0, 16).replace('T', ' ')} ET`;
}

/** "YYYY-MM-DD HH:MM[:SS]" read as New York wall time -> UTC ms, or null. */
export function etToUtcMs(wall: string): number | null {
  const m = wall.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (!m) return null;
  const naive = Date.parse(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}Z`);
  if (!Number.isFinite(naive)) return null;
  return naive - getNyOffset(naive / 1000) * 1000;
}

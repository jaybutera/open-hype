import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * GEXBot readings for sim sessions, from the end-of-day archive that
 * scripts/gex-eod-fetch.mjs saves ($GEX_EOD_DIR/{YYYY-MM-DD}/{TICKER}.zip,
 * default ~/data/gexbot-eod). Each zip holds one day's classic feed per dte as
 * a JSON array of the live responses, one about every 1.5 s from 09:30 to
 * 16:00 ET. The first read of a day unzips it, sorts, keeps one record per
 * SAMPLE_S seconds and caches that under $GEX_EOD_DIR/.replay/, so later
 * loads take milliseconds.
 */
export const GEX_EOD_DIR = process.env.GEX_EOD_DIR || join(homedir(), 'data', 'gexbot-eod');
const SAMPLE_S = 30;

/** One GEXBot classic response; `timestamp` is UTC seconds. */
export interface GexRecord { timestamp: number; [k: string]: unknown }

export function etDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
}

/**
 * One record per `step`-second bucket, the last of each. A lookup is always
 * "last record at or before the cursor", so sampling never serves a reading
 * from after the cursor; it only makes the reading up to `step` seconds older.
 */
export function sampleRecords(recs: GexRecord[], step = SAMPLE_S): GexRecord[] {
  const out: GexRecord[] = [];
  for (const r of recs) {
    const last = out[out.length - 1];
    if (last && Math.floor(last.timestamp / step) === Math.floor(r.timestamp / step)) out[out.length - 1] = r;
    else out.push(r);
  }
  return out;
}

/** Last record with timestamp <= atS (seconds), or null. `recs` sorted by timestamp. */
export function lastAtOrBefore(recs: GexRecord[], atS: number): GexRecord | null {
  let lo = 0;
  let hi = recs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (recs[mid].timestamp <= atS) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? recs[lo - 1] : null;
}

const cache = new Map<string, GexRecord[] | null>();

/** The sampled day for ticker/dte, or null when the archive has no zip for that day. */
export function loadDay(day: string, ticker: string, dte: string, dir = GEX_EOD_DIR): GexRecord[] | null {
  const key = `${dir}/${day}/${ticker}/${dte}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const zip = join(dir, day, `${ticker}.zip`);
  let recs: GexRecord[] | null = null;
  if (existsSync(zip)) {
    const sampled = join(dir, '.replay', day, `${ticker}_${dte}.json.gz`);
    if (existsSync(sampled)) {
      recs = JSON.parse(gunzipSync(readFileSync(sampled)).toString()) as GexRecord[];
    } else {
      // The zip entry is itself gzipped JSON; unzip's own wildcard picks the dated file name.
      const gz = execFileSync('unzip', ['-p', zip, `${ticker}/classic/gex_${dte}/*`], { maxBuffer: 512 * 1024 * 1024 });
      const all = JSON.parse(gunzipSync(gz).toString()) as GexRecord[];
      all.sort((a, b) => a.timestamp - b.timestamp);
      recs = sampleRecords(all);
      mkdirSync(join(dir, '.replay', day), { recursive: true });
      writeFileSync(sampled, gzipSync(JSON.stringify(recs)));
    }
  }
  cache.set(key, recs);
  return recs;
}

/** Archived days (YYYY-MM-DD) holding a zip for `ticker`, ascending. */
export function archivedDays(ticker: string, dir = GEX_EOD_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(join(dir, d, `${ticker}.zip`)))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The reading GEXBot would have served at recorded time `atMs`: the last
 * record of that ET day at or before it. Before the day's first record, the
 * last record of the previous archived day, since the live feed freezes at
 * the 16:00 ET close and shows that until the next open. Null when the
 * archive has nothing at or before `atMs`.
 */
export function readingAt(ticker: string, dte: string, atMs: number, dir = GEX_EOD_DIR): { rec: GexRecord; day: string } | null {
  const day = etDay(atMs);
  const today = loadDay(day, ticker, dte, dir);
  const rec = today && lastAtOrBefore(today, atMs / 1000);
  if (rec) return { rec, day };
  const prev = archivedDays(ticker, dir).filter(d => d < day).pop();
  if (!prev) return null;
  const recs = loadDay(prev, ticker, dte, dir);
  return recs && recs.length > 0 ? { rec: recs[recs.length - 1], day: prev } : null;
}

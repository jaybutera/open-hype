import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Plugin } from 'vite';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

/**
 * Serves locally recorded market history (parquet written by the
 * pp-trader/ict-scanner collector) for replay mode.
 *
 *   GET /api/replay/assets                      -> [{ coin, firstTs, lastTs, ticks? }]
 *   GET /api/replay/candles?coin=X&start=&end=  -> CandleData[] (1m, HL shape)
 *   GET /api/replay/ticks?coin=X&start=&end=    -> Tick[] (BBO quotes)
 *
 * start/end are UTC ms; rows with start <= t < end are returned.
 *
 * Two resolution tiers. `<COIN>_1m.parquet` in the data root covers many coins
 * and months of history. `ticks/<COIN>/<YYYY-MM-DD>/bbo-<HH>.parquet` holds real
 * BBO quotes but only for a handful of coins over a few days — so ticks are an
 * opt-in upgrade for the coins/ranges that have them, never a replacement.
 */
const DATA_DIR = process.env.REPLAY_DATA_DIR ?? '/home/casper/src/ict-scanner/data';
const TICK_DIR = join(DATA_DIR, 'ticks');

/** Max candles per /candles response (a week of 1m is ~10k). */
const MAX_ROWS = 100_000;

/** Max quotes per /ticks response. BTC runs ~24k quotes/hour. */
const MAX_TICKS = 400_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface Row1m {
  t: number; // open time ms UTC
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface CoinCache {
  mtimeMs: number;
  rows: Row1m[]; // sorted by t
}

const cache = new Map<string, CoinCache>();

/**
 * Files eligible for replay: plain `<COIN>_1m.parquet` snapshots for coins the
 * frontend can chart (HL perps + xyz dex). Excludes collector intermediates
 * (reservoir_/tickagg_), dated range extracts, and non-HL sources
 * (Binance *USDT pairs, tradovate E_*, cash:*).
 */
function discoverFiles(): Map<string, string> {
  const out = new Map<string, string>();
  let entries: string[];
  try {
    entries = readdirSync(DATA_DIR);
  } catch {
    return out;
  }
  for (const name of entries) {
    const m = name.match(/^(.+)_1m\.parquet$/);
    if (!m) continue;
    const coin = m[1];
    if (/^(reservoir_|tickagg_|E_)/.test(coin)) continue;
    if (/_\d{8}$/.test(coin) || /_\d{8}_\d{8}$/.test(coin)) continue;
    if (coin.startsWith('cash:')) continue;
    if (coin.endsWith('USDT')) continue;
    out.set(coin, join(DATA_DIR, name));
  }
  return out;
}

async function loadCoin(coin: string, path: string): Promise<CoinCache> {
  const mtimeMs = statSync(path).mtimeMs;
  const cached = cache.get(coin);
  if (cached && cached.mtimeMs === mtimeMs) return cached;

  const file = await asyncBufferFromFile(path);
  const raw = await parquetReadObjects({
    file,
    columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
  });
  const rows: Row1m[] = [];
  for (const r of raw) {
    const ts = r.timestamp instanceof Date ? r.timestamp.getTime() : Number(r.timestamp);
    if (!Number.isFinite(ts)) continue;
    rows.push({
      t: ts,
      o: Number(r.open),
      h: Number(r.high),
      l: Number(r.low),
      c: Number(r.close),
      v: Number(r.volume),
    });
  }
  rows.sort((a, b) => a.t - b.t);
  const entry = { mtimeMs, rows };
  cache.set(coin, entry);
  console.log(`[replay] loaded ${coin}: ${rows.length} 1m candles (${basename(path)})`);
  return entry;
}

/** First index with rows[i].t >= target. */
function lowerBound(rows: Row1m[], target: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function toCandleData(coin: string, r: Row1m) {
  return {
    t: r.t,
    T: r.t + 59_999,
    s: coin,
    i: '1m',
    o: String(r.o),
    h: String(r.h),
    l: String(r.l),
    c: String(r.c),
    v: String(r.v),
    n: 0,
  };
}

/* ---------------------------------------------------------------- ticks --- */

interface Tick {
  t: number;
  bid: number;
  ask: number;
}

/** Cached BBO quotes for one `<coin>/<day>/bbo-<hh>.parquet` shard. */
const tickCache = new Map<string, Tick[]>();

/**
 * Coin dirs under ticks/, keyed by the coin name the frontend uses.
 * Tick dirs are filesystem-safe (`xyz_GOLD`) while the app and the 1m parquet
 * files use the HL name (`xyz:GOLD`), so map underscores back to the colon form.
 */
function discoverTickCoins(): Map<string, string> {
  const out = new Map<string, string>();
  let entries: string[];
  try {
    entries = readdirSync(TICK_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return out;
  }
  for (const name of entries) {
    const coin = name.startsWith('xyz_') ? `xyz:${name.slice(4)}` : name;
    out.set(coin, join(TICK_DIR, name));
  }
  return out;
}

function utcDayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Recorded tick range for a coin, derived from the day dirs and the hour shards
 * at each end. Returns null when the coin has no usable shards.
 */
function tickCoverage(dir: string): { firstTs: number; lastTs: number } | null {
  let days: string[];
  try {
    days = readdirSync(dir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  } catch {
    return null;
  }
  const hoursOf = (day: string): number[] =>
    readdirSync(join(dir, day))
      .map(f => f.match(/^bbo-(\d{2})\.parquet$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => Number(m[1]))
      .sort((a, b) => a - b);

  // Skip edge days that hold only trades-* shards and no bbo-*.
  let firstDay: string | undefined;
  let firstHours: number[] = [];
  for (const d of days) {
    const h = hoursOf(d);
    if (h.length > 0) { firstDay = d; firstHours = h; break; }
  }
  let lastDay: string | undefined;
  let lastHours: number[] = [];
  for (let i = days.length - 1; i >= 0; i--) {
    const h = hoursOf(days[i]);
    if (h.length > 0) { lastDay = days[i]; lastHours = h; break; }
  }
  if (!firstDay || !lastDay) return null;

  const firstTs = Date.parse(`${firstDay}T00:00:00Z`) + firstHours[0] * HOUR_MS;
  // The last shard covers its full hour.
  const lastTs = Date.parse(`${lastDay}T00:00:00Z`) + (lastHours[lastHours.length - 1] + 1) * HOUR_MS;
  return { firstTs, lastTs };
}

/** Load one hour shard, or [] when that hour wasn't recorded. */
async function loadTickShard(dir: string, hourStart: number): Promise<Tick[]> {
  const day = utcDayStr(hourStart);
  const hh = String(new Date(hourStart).getUTCHours()).padStart(2, '0');
  const key = `${dir}/${day}/${hh}`;
  const cached = tickCache.get(key);
  if (cached) return cached;

  const path = join(dir, day, `bbo-${hh}.parquet`);
  if (!existsSync(path)) {
    tickCache.set(key, []);
    return [];
  }

  const file = await asyncBufferFromFile(path);
  const raw = await parquetReadObjects({
    file,
    columns: ['time', 'bid_px', 'ask_px'],
  });
  const ticks: Tick[] = [];
  for (const r of raw) {
    const t = Number(r.time);
    const bid = Number(r.bid_px);
    const ask = Number(r.ask_px);
    if (!Number.isFinite(t) || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
    ticks.push({ t, bid, ask });
  }
  ticks.sort((a, b) => a.t - b.t);
  tickCache.set(key, ticks);
  return ticks;
}

/** BBO quotes with start <= t < end, spanning however many hour shards that covers. */
async function loadTicks(dir: string, start: number, end: number): Promise<Tick[]> {
  const out: Tick[] = [];
  const firstHour = Math.floor(start / HOUR_MS) * HOUR_MS;
  for (let h = firstHour; h < end; h += HOUR_MS) {
    const shard = await loadTickShard(dir, h);
    for (const tk of shard) {
      if (tk.t < start) continue;
      if (tk.t >= end) break;
      out.push(tk);
      if (out.length >= MAX_TICKS) return out;
    }
  }
  return out;
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function replayDataPlugin(): Plugin {
  return {
    name: 'replay-data',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/replay/')) return next();
        const url = new URL(req.url, 'http://localhost');

        try {
          if (url.pathname === '/api/replay/assets') {
            const files = discoverFiles();
            const tickCoins = discoverTickCoins();
            const assets = await Promise.all(
              Array.from(files.entries()).map(async ([coin, path]) => {
                const { rows } = await loadCoin(coin, path);
                if (rows.length === 0) return null;
                const tickDir = tickCoins.get(coin);
                const ticks = tickDir ? tickCoverage(tickDir) : null;
                return {
                  coin,
                  firstTs: rows[0].t,
                  lastTs: rows[rows.length - 1].t,
                  ...(ticks ? { ticks } : {}),
                };
              }),
            );
            return sendJson(res, 200, assets.filter(Boolean));
          }

          if (url.pathname === '/api/replay/ticks') {
            const coin = url.searchParams.get('coin') ?? '';
            const start = Number(url.searchParams.get('start'));
            const end = Number(url.searchParams.get('end'));
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
              return sendJson(res, 400, { error: 'start and end (ms) required' });
            }
            const tickDir = discoverTickCoins().get(coin);
            if (!tickDir) {
              return sendJson(res, 404, { error: `no tick data for ${coin}` });
            }
            if (end - start > DAY_MS) {
              return sendJson(res, 400, { error: 'range too large (max 24h)' });
            }
            return sendJson(res, 200, await loadTicks(tickDir, start, end));
          }

          if (url.pathname === '/api/replay/candles') {
            const coin = url.searchParams.get('coin') ?? '';
            const start = Number(url.searchParams.get('start'));
            const end = Number(url.searchParams.get('end'));
            const path = discoverFiles().get(coin);
            if (!path) return sendJson(res, 404, { error: `no replay data for ${coin}` });
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
              return sendJson(res, 400, { error: 'start and end (ms) required' });
            }
            const { rows } = await loadCoin(coin, path);
            const from = lowerBound(rows, start);
            const to = Math.min(lowerBound(rows, end), from + MAX_ROWS);
            const out = [];
            for (let i = from; i < to; i++) out.push(toCandleData(coin, rows[i]));
            return sendJson(res, 200, out);
          }

          return sendJson(res, 404, { error: 'unknown replay endpoint' });
        } catch (e) {
          return sendJson(res, 500, { error: String((e as Error)?.message ?? e) });
        }
      });
    },
  };
}

import { readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Plugin } from 'vite';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

/**
 * Serves locally recorded 1m candles (parquet files written by the
 * pp-trader/ict-scanner collector) for replay mode.
 *
 *   GET /api/replay/assets                      -> [{ coin, firstTs, lastTs }]
 *   GET /api/replay/candles?coin=X&start=&end=  -> CandleData[] (1m, HL shape)
 *
 * start/end are UTC ms; candles with start <= t < end are returned.
 */
const DATA_DIR = process.env.REPLAY_DATA_DIR ?? '/home/casper/src/ict-scanner/data';

/** Max candles per /candles response (a week of 1m is ~10k). */
const MAX_ROWS = 100_000;

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
            const assets = await Promise.all(
              Array.from(files.entries()).map(async ([coin, path]) => {
                const { rows } = await loadCoin(coin, path);
                if (rows.length === 0) return null;
                return { coin, firstTs: rows[0].t, lastTs: rows[rows.length - 1].t };
              }),
            );
            return sendJson(res, 200, assets.filter(Boolean));
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

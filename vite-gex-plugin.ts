import type { Plugin, ViteDevServer } from 'vite';
import { loadEnv } from 'vite';
import { GEX_EOD_DIR, etDay, loadDay, readingAt } from './gex-archive';

/**
 * Proxies GEXBot's classic feed for the page so the API key stays on the server.
 *
 *   GET /api/gex/tickers            -> { stocks, indexes, futures } (no key needed upstream)
 *   GET /api/gex/:ticker/:dte       -> the raw GEXBot response; dte is zero | one | full
 *
 * Reads GEXBOT_API_KEY from the environment or a .env file at the project root.
 * Each ticker/dte answer is cached for CACHE_MS so several open tabs share one
 * upstream call a minute; GEXBot refreshes about that often during the session.
 *
 * Sim sessions (SIM=1, specs/sim.md) replay history, which GEXBot does not
 * serve, so the answer comes from the end-of-day archive (gex-archive.ts):
 * the record at the replay cursor, moved by SIM_SHIFT_MS like the candles.
 * A day the archive does not hold still answers 503.
 */
const UPSTREAM = 'https://api.gexbot.com';
const CACHE_MS = 60_000;
const TICKERS_CACHE_MS = 6 * 60 * 60_000;
const TICKER_RE = /^[A-Z0-9_]{1,12}$/;
const DTES = new Set(['zero', 'one', 'full']);
const SIM = process.env.SIM === '1';
const SHIFT = Number(process.env.SIM_SHIFT_MS || 0);

/** The sim's replay cursor (UTC ms, shifted) from this same server, or null when no sim runs. */
async function simCursor(server: ViteDevServer): Promise<number | null> {
  const addr = server.httpServer?.address();
  const port = typeof addr === 'object' && addr ? addr.port : server.config.server.port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/sim/clock`, { signal: AbortSignal.timeout(2000) });
    const j = (await r.json()) as { active?: boolean; cursor?: number };
    return r.ok && j.active && Number.isFinite(j.cursor) ? j.cursor! : null;
  } catch {
    return null;
  }
}

interface Cached { at: number; status: number; body: string }

export function gexPlugin(): Plugin {
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<Cached>>();
  let apiKey = '';

  const fetchCached = (key: string, url: string, ttl: number, headers: Record<string, string>): Promise<Cached> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit);
    const running = inflight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
        const body = await r.text();
        const entry = { at: Date.now(), status: r.status, body };
        // Keep a stale good answer rather than caching an upstream failure.
        if (r.ok || !hit) cache.set(key, entry);
        return r.ok ? entry : hit ?? entry;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };

  return {
    name: 'hl-gex-proxy',
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, 'GEXBOT_');
      apiKey = process.env.GEXBOT_API_KEY || env.GEXBOT_API_KEY || '';
      if (!apiKey) config.logger.warn('[gex] GEXBOT_API_KEY is not set; /api/gex/:ticker will answer 503');
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || req.method !== 'GET') return next();
        const m = req.url.match(/^\/api\/gex\/([^/?]+)(?:\/([^/?]+))?(?:\?.*)?$/);
        if (!m) return next();
        const send = (status: number, body: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        };
        try {
          if (m[1] === 'tickers' && !m[2]) {
            const c = await fetchCached('tickers', `${UPSTREAM}/tickers`, TICKERS_CACHE_MS, {});
            return send(c.status, c.body);
          }
          const ticker = m[1].toUpperCase();
          const dte = m[2] ?? 'zero';
          if (!TICKER_RE.test(ticker) || !DTES.has(dte)) return send(400, JSON.stringify({ error: 'bad ticker or dte' }));
          if (SIM) {
            const cursor = await simCursor(server);
            if (cursor === null) return send(503, JSON.stringify({ error: 'gexbot answered 503' }));
            const recordedMs = cursor - SHIFT;
            const hit = readingAt(ticker, dte, recordedMs);
            if (!hit) {
              const archivedToday = loadDay(etDay(recordedMs), ticker, dte) !== null;
              return send(503, JSON.stringify({
                error: archivedToday
                  ? `no ${ticker} reading yet today; the feed publishes from 09:30 ET`
                  : 'gexbot answered 503',
                ...(archivedToday ? {} : { note: `no archived GEX for ${etDay(recordedMs)} under ${GEX_EOD_DIR}` }),
              }));
            }
            return send(200, JSON.stringify({ ...hit.rec, timestamp: hit.rec.timestamp + Math.round(SHIFT / 1000) }));
          }
          if (!apiKey) return send(503, JSON.stringify({ error: 'GEXBOT_API_KEY is not set on the dev server' }));
          const c = await fetchCached(
            `${ticker}/${dte}`,
            `${UPSTREAM}/${ticker}/classic/${dte}`,
            CACHE_MS,
            { Authorization: `Basic ${apiKey}` },
          );
          if (!c.body.trim()) return send(c.status, JSON.stringify({ error: `gexbot answered ${c.status}` }));
          return send(c.status, c.body);
        } catch (e) {
          return send(502, JSON.stringify({ error: String((e as Error)?.message || e) }));
        }
      });
    },
  };
}

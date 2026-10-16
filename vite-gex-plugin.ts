import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  GexSampleStore, etDayStart, isRth, lookbackRows, sampleFromJson, sampleFromRaw, tradingDaysStart,
  type GexSample,
} from './src/services/gex/samples.ts';
import { lookbacksFor } from './src/services/gex/lookbacks.ts';
import { formatEt } from './src/utils/chartTime.ts';

/**
 * Proxies GEXBot's classic feed for the page so the API key stays on the server.
 *
 *   GET /api/gex/tickers            -> { stocks, indexes, futures } (no key needed upstream)
 *   GET /api/gex/:ticker/:dte       -> the raw GEXBot response; dte is zero | one | full
 *   GET /api/gex/:ticker/:dte/history?from=&to=&interval=&lookbacks=
 *                                   -> { ticker, dte, samples, lookbacks } from our own 1-minute samples
 *
 * Reads GEXBOT_API_KEY from the environment or a .env file at the project root.
 * Each ticker/dte answer is cached for CACHE_MS so several open tabs share one
 * upstream call a minute; GEXBot refreshes about that often during the session.
 *
 * GEXBot keeps no history of zero gamma or the major strikes, so this plugin
 * records it: every fresh upstream reading becomes a sample, and during RTH a
 * sampler fetches GEX_SAMPLE_TICKERS (default SPX,NDX,TSLA,SPY,QQQ) for all
 * three dtes once a minute. Samples append to
 * GEX_SAMPLE_DIR/YYYY-MM-DD/TICKER_dte.jsonl (default ~/data/gex-samples, ET
 * date) and the last SAMPLE_DAYS trading days stay in memory. See specs/gex-trail.md.
 */
const UPSTREAM = 'https://api.gexbot.com';
const CACHE_MS = 60_000;
const TICKERS_CACHE_MS = 6 * 60 * 60_000;
const TICKER_RE = /^[A-Z0-9_]{1,12}$/;
const DTES = new Set(['zero', 'one', 'full']);

interface Cached { at: number; status: number; body: string }

const SAMPLE_MS = 60_000;
const SAMPLE_DAYS = 5;
const DEFAULT_SAMPLE_TICKERS = 'SPX,NDX,TSLA,SPY,QQQ';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_RE = /^([A-Z0-9_]{1,12})_(zero|one|full)\.jsonl$/;

function sampleDir(): string {
  const d = process.env.GEX_SAMPLE_DIR || '~/data/gex-samples';
  return d.startsWith('~') ? join(homedir(), d.slice(1)) : d;
}

function sampleTickers(): string[] {
  return (process.env.GEX_SAMPLE_TICKERS || DEFAULT_SAMPLE_TICKERS)
    .split(',').map(t => t.trim().toUpperCase()).filter(t => TICKER_RE.test(t));
}

function numParam(q: URLSearchParams, name: string): number | null {
  const v = q.get(name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function gexPlugin(): Plugin {
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<Cached>>();
  let apiKey = '';
  const store = new GexSampleStore(SAMPLE_DAYS);
  const dir = sampleDir();
  let loaded: Promise<void> = Promise.resolve();
  let log: (msg: string) => void = () => {};

  const record = (key: string, body: string) => {
    if (!/^[A-Z0-9_]{1,12}\/(zero|one|full)$/.test(key)) return;
    let s: GexSample | null = null;
    try { s = sampleFromRaw(JSON.parse(body)); } catch { return; }
    if (!s || !store.add(key, s)) return;
    const day = formatEt(s.t).slice(0, 10);
    const file = join(dir, day, `${key.replace('/', '_')}.jsonl`);
    void mkdir(join(dir, day), { recursive: true })
      .then(() => appendFile(file, JSON.stringify(s) + '\n'))
      .catch(e => log(`[gex] sample write failed: ${String((e as Error)?.message || e)}`));
  };

  const loadSamples = async () => {
    const cutoff = tradingDaysStart(Date.now(), SAMPLE_DAYS);
    let days: string[] = [];
    try { days = (await readdir(dir)).filter(d => DAY_RE.test(d)); } catch { return; }
    let n = 0;
    for (const day of days.sort()) {
      // Day folders are ET dates; skip whole days before the cutoff without reading them.
      const dayEnd = etDayStart(Date.parse(`${day}T12:00:00Z`)) + 36 * 3600_000;
      if (dayEnd < cutoff) continue;
      let files: string[] = [];
      try { files = await readdir(join(dir, day)); } catch { continue; }
      for (const f of files) {
        const m = f.match(FILE_RE);
        if (!m) continue;
        const text = await readFile(join(dir, day, f), 'utf8').catch(() => '');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          let s: GexSample | null = null;
          try { s = sampleFromJson(JSON.parse(line)); } catch { continue; }
          if (s && store.add(`${m[1]}/${m[2]}`, s)) n++;
        }
      }
    }
    store.trim(Date.now());
    log(`[gex] loaded ${n} samples from ${dir}`);
  };

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
        if (r.ok) record(key, body);
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
      log = (msg) => server.config.logger.info(msg);
      const sampling = process.env.SIM !== '1' && !!apiKey;
      if (sampling) {
        loaded = mkdir(dir, { recursive: true }).then(loadSamples).catch(e => log(`[gex] sample load failed: ${String(e)}`));
        const tickers = sampleTickers();
        let running = false;
        const tick = async () => {
          if (running || !isRth(Date.now())) return;
          running = true;
          try {
            for (const t of tickers) {
              for (const dte of DTES) {
                await fetchCached(`${t}/${dte}`, `${UPSTREAM}/${t}/classic/${dte}`, CACHE_MS, { Authorization: `Basic ${apiKey}` })
                  .catch(() => undefined);
              }
            }
            store.trim(Date.now());
          } finally {
            running = false;
          }
        };
        const timer = setInterval(() => void tick(), SAMPLE_MS);
        timer.unref?.();
        server.httpServer?.once('close', () => clearInterval(timer));
        void loaded.then(tick);
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || req.method !== 'GET') return next();
        const h = req.url.match(/^\/api\/gex\/([^/?]+)\/([^/?]+)\/history(?:\?(.*))?$/);
        if (h) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          const ticker = h[1].toUpperCase();
          const dte = h[2];
          if (!TICKER_RE.test(ticker) || !DTES.has(dte)) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'bad ticker or dte' }));
          }
          await loaded;
          const q = new URLSearchParams(h[3] ?? '');
          const now = Date.now();
          const to = numParam(q, 'to') ?? now;
          const from = numParam(q, 'from') ?? etDayStart(now);
          const samples = store.range(`${ticker}/${dte}`, from, to);
          const lbParam = q.get('lookbacks');
          const minutes = lbParam
            ? lbParam.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
            : [...lookbacksFor(q.get('interval'))];
          // Lookbacks read from the full stored history, so a narrow from/to still finds them.
          const upTo = store.range(`${ticker}/${dte}`, 0, to);
          res.statusCode = 200;
          return res.end(JSON.stringify({ ticker, dte, samples, lookbacks: lookbackRows(upTo, minutes) }));
        }
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
          // Sim sessions replay history; GEXBot has only the present, so it reads as down.
          if (process.env.SIM === '1') return send(503, JSON.stringify({ error: 'gexbot answered 503' }));
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

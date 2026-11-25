import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { SignalBook, SignalValidationError } from './src/services/signals/book.ts';

/**
 * Strategy signals: an outside process (scripts/strategy-signals.py, or
 * anything that can POST JSON) reports trade setups, and the page lists them
 * in the right column. Clicking one draws it on the chart. Dev server only.
 *
 *   GET    /api/signals        -> { signals, sources } newest first; sources = each pusher's last push time
 *   POST   /api/signals        -> { source, signals: Signal[], replace?, lagSec?, watching? }; upsert by source + key
 *   DELETE /api/signals[?id=]  -> remove one signal (or all); a removed id stays out while its source keeps sending it
 *
 * A Signal is { key, asset, entry, stop, target, time, side?, tf?, strategy?,
 * status?, statusNote?, endTime?, note?, shapes? }; `shapes` takes the same
 * shapes as POST /api/ai/overlays. See src/services/signals/book.ts.
 *
 * The list is kept in memory: a pusher sends its whole current list with
 * `replace: true` on every cycle, so a restarted server is filled again within
 * one cycle.
 *
 * Websocket events: server -> client hl-signals:list { signals, sources }, client -> server hl-signals:hello {}.
 */
const MAX_BODY = 2_000_000;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

export function signalsPlugin(): Plugin {
  const book = new SignalBook();
  return {
    name: 'hl-signals',
    configureServer(server) {
      const payload = () => ({ signals: book.list(), sources: book.listSources() });
      const broadcast = () => server.ws.send('hl-signals:list', payload());
      server.ws.on('hl-signals:hello', (_data: unknown, client) => client.send('hl-signals:list', payload()));

      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const url = new URL(req.url, 'http://x');
        if (url.pathname !== '/api/signals') return next();
        try {
          if (req.method === 'GET') return sendJson(res, 200, payload());
          if (req.method === 'POST') {
            const result = book.push(await readJson(req));
            // Every push goes out, also an unchanged one: the page shows when each source last reported.
            broadcast();
            if (result.added.length) server.config.logger.info(`[signals] new: ${result.added.join(', ')}`);
            return sendJson(res, 200, result);
          }
          if (req.method === 'DELETE') {
            const id = url.searchParams.get('id');
            const removed = id ? (book.dismiss(id) ? 1 : 0) : book.clear();
            if (removed) broadcast();
            return sendJson(res, 200, { ok: true, removed });
          }
          return sendJson(res, 405, { error: 'use GET, POST or DELETE' });
        } catch (e) {
          if (e instanceof SignalValidationError) return sendJson(res, 400, { error: e.message, details: e.details });
          return sendJson(res, 400, { error: String((e as Error).message ?? e) });
        }
      });
    },
  };
}

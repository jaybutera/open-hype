import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { normalizePush, OverlayValidationError } from './src/services/ai/validate.ts';
import type { ChartSnapshot, OverlaySet } from './src/services/ai/types.ts';

/**
 * Bridge between an AI (Claude Code via scripts/hl-chart-mcp.mjs) and the open
 * chart page. Dev server only.
 *
 *   GET    /api/ai/view          -> fresh ChartSnapshot from the page (or cached + stale)
 *   POST   /api/ai/overlays      -> { sets: OverlaySetInput[], replace? } validate + store + broadcast
 *   DELETE /api/ai/overlays[?id] -> clear all (or one) sets
 *   GET    /api/ai/overlays      -> current set list
 *
 * Page <-> server traffic uses Vite custom websocket events:
 *   client -> server  hl-ai:snapshot { snapshot, reqId? }, hl-ai:toggle { id, enabled }, hl-ai:hello {}
 *   server -> client  hl-ai:snapshot-request { reqId }, hl-ai:overlays { sets }
 */
const SNAPSHOT_TIMEOUT_MS = 1500;
const MAX_BODY = 1_000_000;

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
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve(undefined);
      try { resolve(JSON.parse(text)); } catch { reject(new Error('body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

export function aiOverlayPlugin(): Plugin {
  let snapshot: ChartSnapshot | null = null;
  let sets: OverlaySet[] = [];
  const enabled = new Set<string>();
  const waiters = new Map<string, (s: ChartSnapshot) => void>();
  let reqSeq = 0;

  /** The server's set list is authoritative; toggles come from the page. */
  const withOverlays = (s: ChartSnapshot): ChartSnapshot => ({
    ...s,
    overlays: sets.map(x => ({ id: x.id, name: x.name, enabled: enabled.has(x.id) })),
  });

  return {
    name: 'hl-ai-overlays',
    configureServer(server) {
      // `enabled` rides along so a reloaded page gets its toggles back.
      const overlaysPayload = () => ({ sets, enabled: [...enabled] });
      const broadcast = () => server.ws.send('hl-ai:overlays', overlaysPayload());

      server.ws.on('hl-ai:snapshot', (data: { snapshot?: ChartSnapshot; reqId?: string }) => {
        if (!data?.snapshot || typeof data.snapshot !== 'object') return;
        snapshot = data.snapshot;
        // The page's toggle state wins for ids the server knows about.
        for (const o of snapshot.overlays ?? []) {
          if (!sets.some(x => x.id === o.id)) continue;
          if (o.enabled) enabled.add(o.id); else enabled.delete(o.id);
        }
        if (data.reqId) {
          const w = waiters.get(data.reqId);
          if (w) { waiters.delete(data.reqId); w(snapshot); }
        }
      });

      server.ws.on('hl-ai:toggle', (data: { id?: string; enabled?: boolean }) => {
        if (!data?.id) return;
        if (data.enabled) enabled.add(data.id); else enabled.delete(data.id);
      });

      server.ws.on('hl-ai:hello', (_data: unknown, client) => {
        client.send('hl-ai:overlays', overlaysPayload());
      });

      const requestSnapshot = (): Promise<ChartSnapshot | null> => {
        const reqId = `r${++reqSeq}`;
        return new Promise(resolve => {
          const timer = setTimeout(() => { waiters.delete(reqId); resolve(null); }, SNAPSHOT_TIMEOUT_MS);
          waiters.set(reqId, s => { clearTimeout(timer); resolve(s); });
          server.ws.send('hl-ai:snapshot-request', { reqId });
        });
      };

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/ai/')) return next();
        const url = new URL(req.url, 'http://localhost');

        try {
          if (url.pathname === '/api/ai/view' && req.method === 'GET') {
            const fresh = await requestSnapshot();
            if (fresh) return sendJson(res, 200, withOverlays(fresh));
            if (snapshot) return sendJson(res, 200, { ...withOverlays(snapshot), stale: true });
            return sendJson(res, 404, { error: 'no chart connected' });
          }

          if (url.pathname === '/api/ai/overlays') {
            if (req.method === 'GET') return sendJson(res, 200, { sets });

            if (req.method === 'DELETE') {
              const id = url.searchParams.get('id');
              if (id) {
                const before = sets.length;
                sets = sets.filter(s => s.id !== id);
                enabled.delete(id);
                if (sets.length === before) return sendJson(res, 404, { error: `no overlay set with id ${id}` });
              } else {
                sets = [];
                enabled.clear();
              }
              broadcast();
              return sendJson(res, 200, { ok: true, remaining: sets.length });
            }

            if (req.method === 'POST') {
              let body: unknown;
              try {
                body = await readJson(req);
              } catch (e) {
                return sendJson(res, 400, { error: (e as Error).message, details: [] });
              }
              // Validate against what the user sees now, not an old cached view.
              const current = (await requestSnapshot()) ?? snapshot;
              try {
                const r = normalizePush(body, current, { existingCount: sets.length });
                if (r.replace) { sets = []; enabled.clear(); }
                sets = [...sets, ...r.sets];
                broadcast();
                const warnings = [...r.warnings];
                if (!current) warnings.unshift('no chart snapshot yet: times were not snapped and prices not checked');
                return sendJson(res, 200, {
                  ok: true,
                  sets: r.sets.map(s => ({ id: s.id, name: s.name })),
                  warnings,
                });
              } catch (e) {
                if (e instanceof OverlayValidationError) {
                  return sendJson(res, 400, { error: e.message, details: e.details });
                }
                throw e;
              }
            }
            return sendJson(res, 405, { error: `method ${req.method} not allowed` });
          }

          return sendJson(res, 404, { error: 'unknown ai endpoint' });
        } catch (e) {
          return sendJson(res, 500, { error: String((e as Error)?.message ?? e) });
        }
      });
    },
  };
}

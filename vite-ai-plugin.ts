import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { normalizePush, OverlayValidationError } from './src/services/ai/validate.ts';
import type { ChartSnapshot, OverlaySet } from './src/services/ai/types.ts';
import { AlertValidationError } from './src/services/ai/alerts.ts';
import { AlertEngine, type SimBar } from './alert-engine.ts';
import { SimClock, type SimParams } from './sim-clock.ts';
import { TradeDesk, TradeValidationError, describeAction } from './src/services/ai/trades.ts';

/**
 * Bridge between an AI (Claude Code via scripts/hl-chart-mcp.mjs) and the open
 * chart page. Dev server only.
 *
 *   GET    /api/ai/view          -> fresh ChartSnapshot from the page (or cached + stale)
 *   POST   /api/ai/overlays      -> { sets: OverlaySetInput[], replace? } validate + store + broadcast
 *   DELETE /api/ai/overlays[?id] -> clear all (or one) sets
 *   GET    /api/ai/overlays      -> current set list
 *   GET    /api/ai/alerts        -> { alerts } (armed and fired)
 *   POST   /api/ai/alerts        -> AlertInput; arms a price alert (alert-engine.ts watches Hyperliquid)
 *   DELETE /api/ai/alerts[?id]   -> remove one (or all)
 *   GET    /api/ai/alerts/wait?id=&timeout= -> long-poll; { status: 'fired', alert } once it fires
 *   GET    /api/ai/trades        -> { trades } (open and recently finished proposals)
 *   POST   /api/ai/trades        -> { action, note?, mode?, expiresInSec? }; stores a proposal for the page to confirm
 *   DELETE /api/ai/trades?id=    -> withdraw a pending proposal
 *   GET    /api/ai/trades/wait?id=&timeout= -> long-poll; { status, trade } once it is decided
 *   POST   /api/ai/trades/claim?id=  -> page only: { decidedBy } pending -> executing; 409 if someone else got it
 *   POST   /api/ai/trades/result?id= -> page only: { ok, message } executing -> done/failed
 *   POST   /api/ai/trades/reject?id= -> page only: { reason? } pending -> rejected
 *
 * Trades are signed and sent by the page with the key it holds; this server
 * never sees a key and never calls the exchange.
 *
 * Sim sessions (SIM=1, see specs/sim.md) add:
 *   POST   /api/sim/start       -> SimParams; the page enters replay at start
 *   GET    /api/sim/clock       -> { active, state, cursor, end, endReason }
 *   POST   /api/sim/idle        -> Stop hook: the agent's turn ended; replay runs until a wait resolves
 *   POST   /api/sim/busy        -> PreToolUse / UserPromptSubmit hook: the agent is working
 *   POST   /api/sim/stop        -> end the session
 *
 * Page <-> server traffic uses Vite custom websocket events:
 *   client -> server  hl-ai:snapshot { snapshot, reqId? }, hl-ai:toggle { id, enabled }, hl-ai:hello {}
 *   server -> client  hl-ai:snapshot-request { reqId }, hl-ai:overlays { sets }, hl-ai:alerts { alerts }, hl-ai:trades { trades }
 *   sim:  server -> client hl-ai:sim-start, hl-ai:sim-advance { reqId, minutes }
 *         client -> server hl-ai:sim-started { cursor | error }, hl-ai:sim-tick { reqId, cursor, atEnd, minutes }
 */
const SIM = process.env.SIM === '1';
const SIM_START_TIMEOUT_MS = 60_000;
const SIM_TICK_TIMEOUT_MS = 30_000;
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

interface SimTick {
  reqId: string;
  cursor: number;
  atEnd?: boolean;
  minutes: Array<Record<string, SimBar>>;
  error?: string;
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

      const sim = new SimClock(process.env.SIM_LOG || null, msg => server.config.logger.info(`[hl-sim] ${msg}`));
      const engine = new AlertEngine(
        // A sim keeps its alerts in its run dir, so sims on different ports do not share them.
        SIM ? resolve(dirname(process.env.SIM_LOG || '.'), '.hl-alerts.sim.json') : resolve(server.config.root, '.hl-alerts.json'),
        msg => server.config.logger.info(`[hl-ai alerts] ${msg}`),
        SIM ? { feed: 'manual', now: () => sim.cursor } : {},
      );
      if (SIM) engine.clear();
      const alertsPayload = () => ({ alerts: engine.list() });
      engine.onChange(() => server.ws.send('hl-ai:alerts', alertsPayload()));
      server.httpServer?.once('close', () => engine.close());

      const desk = new TradeDesk();
      const tradesPayload = () => ({ trades: desk.list() });
      desk.onChange(() => server.ws.send('hl-ai:trades', tradesPayload()));
      const sweep = setInterval(() => desk.sweep(), 5000);
      sweep.unref?.();
      server.httpServer?.once('close', () => clearInterval(sweep));

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

      /* ------------------------------------------------------------ sim --- */

      // Open long-polls per alert id: a fired alert someone is waiting on wakes the agent at once.
      const alertPolls = new Map<string, number>();
      engine.onChange((_alerts, fired) => {
        if (!SIM || !fired) return;
        sim.event('alert-fired', { id: fired.id, level: fired.level, price: fired.firedPrice, note: fired.note });
        if (alertPolls.get(fired.id)) sim.wake(fired.id, 'alert');
      });

      let simStarted: ((d: { cursor?: number; error?: string }) => void) | null = null;
      server.ws.on('hl-ai:sim-started', (d: { cursor?: number; error?: string }) => simStarted?.(d));
      const tickWaiters = new Map<string, (d: SimTick) => void>();
      server.ws.on('hl-ai:sim-tick', (d: SimTick) => {
        const w = tickWaiters.get(d?.reqId);
        if (w) { tickWaiters.delete(d.reqId); w(d); }
      });
      const requestAdvance = (minutes: number): Promise<SimTick | null> => {
        const reqId = `s${++reqSeq}`;
        return new Promise(resolve => {
          const timer = setTimeout(() => { tickWaiters.delete(reqId); resolve(null); }, SIM_TICK_TIMEOUT_MS);
          tickWaiters.set(reqId, d => { clearTimeout(timer); resolve(d); });
          server.ws.send('hl-ai:sim-advance', { reqId, minutes });
        });
      };

      // Step the replay one minute at a time while the agent is idle.
      let looping = false;
      const runIdle = async () => {
        if (looping) return;
        looping = true;
        try {
          while (sim.state === 'idle') {
            if (sim.params && sim.cursor >= sim.params.end) { sim.finish('reached end'); break; }
            const tick = await requestAdvance(1);
            if (!tick || tick.error) { sim.finish(`page did not advance: ${tick?.error ?? 'timeout'}`); break; }
            sim.cursor = tick.cursor;
            for (const m of tick.minutes) {
              for (const [coin, bar] of Object.entries(m)) engine.ingestBar(coin, bar);
            }
            if (tick.atEnd) { sim.finish('data ended'); break; }
          }
        } finally {
          looping = false;
        }
      };
      sim.onIdle(() => { void runIdle(); });

      server.ws.on('hl-ai:toggle', (data: { id?: string; enabled?: boolean }) => {
        if (!data?.id) return;
        if (data.enabled) enabled.add(data.id); else enabled.delete(data.id);
      });

      server.ws.on('hl-ai:hello', (_data: unknown, client) => {
        client.send('hl-ai:overlays', overlaysPayload());
        client.send('hl-ai:alerts', alertsPayload());
        client.send('hl-ai:trades', tradesPayload());
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
        if (!req.url || !req.url.startsWith('/api/sim/')) return next();
        if (!SIM) return sendJson(res, 404, { error: 'not a sim server (start it with SIM=1)' });
        const path = new URL(req.url, 'http://localhost').pathname;
        try {
          if (path === '/api/sim/clock' && req.method === 'GET') {
            return sendJson(res, 200, {
              active: sim.active, state: sim.state, cursor: sim.cursor,
              end: sim.params?.end ?? null, endReason: sim.endReason,
            });
          }
          if (req.method !== 'POST') return sendJson(res, 405, { error: `method ${req.method} not allowed` });
          if (path === '/api/sim/start') {
            const p = (await readJson(req)) as Partial<SimParams> | undefined;
            if (!p?.asset || !p.interval || !Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end! <= p.start!) {
              return sendJson(res, 400, { error: 'need asset, interval, start, end (UTC ms, end > start)' });
            }
            sim.begin(p as SimParams);
            const started = await new Promise<{ cursor?: number; error?: string } | null>(done => {
              const timer = setTimeout(() => { simStarted = null; done(null); }, SIM_START_TIMEOUT_MS);
              simStarted = d => { clearTimeout(timer); simStarted = null; done(d); };
              server.ws.send('hl-ai:sim-start', p);
            });
            if (!started || started.error || started.cursor === undefined) {
              sim.finish(`start failed: ${started?.error ?? 'no page answered'}`);
              return sendJson(res, 502, { error: started?.error ?? 'no page answered hl-ai:sim-start; is a browser open on this server?' });
            }
            sim.started(started.cursor);
            return sendJson(res, 200, { ok: true, cursor: sim.cursor });
          }
          if (path === '/api/sim/idle') { sim.idle(); return sendJson(res, 200, { state: sim.state }); }
          if (path === '/api/sim/busy') { sim.activity(); return sendJson(res, 200, { state: sim.state }); }
          if (path === '/api/sim/stop') { sim.finish('stopped'); return sendJson(res, 200, { state: sim.state }); }
          return sendJson(res, 404, { error: 'unknown sim endpoint' });
        } catch (e) {
          return sendJson(res, 500, { error: String((e as Error)?.message ?? e) });
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/ai/')) return next();
        const url = new URL(req.url, 'http://localhost');

        try {
          if (url.pathname === '/api/ai/view' && req.method === 'GET') {
            const fresh = await requestSnapshot();
            const view = (s: ChartSnapshot) => ({
              ...withOverlays(s),
              ...(SIM ? { replay: false } : {}),
              alerts: engine.list().filter(a => a.asset === s.asset),
              proposals: desk.list().slice(-10),
            });
            if (fresh) return sendJson(res, 200, view(fresh));
            if (snapshot) return sendJson(res, 200, { ...view(snapshot), stale: true });
            return sendJson(res, 404, { error: 'no chart connected' });
          }

          if (url.pathname === '/api/ai/alerts/wait' && req.method === 'GET') {
            const id = url.searchParams.get('id') ?? '';
            const timeout = Math.min(30, Math.max(0, Number(url.searchParams.get('timeout') ?? 30) || 0));
            alertPolls.set(id, (alertPolls.get(id) ?? 0) + 1);
            let fired;
            try {
              fired = await engine.wait(id, timeout * 1000);
            } finally {
              alertPolls.set(id, (alertPolls.get(id) ?? 1) - 1);
            }
            if (SIM && fired) sim.wake(id, 'alert');
            if (fired === undefined) return sendJson(res, 404, { error: `no alert with id ${id}` });
            if (fired === null) return sendJson(res, 200, { status: 'armed' });
            return sendJson(res, 200, { status: 'fired', alert: fired });
          }

          if (url.pathname === '/api/ai/alerts') {
            if (req.method === 'GET') return sendJson(res, 200, alertsPayload());

            if (req.method === 'DELETE') {
              const id = url.searchParams.get('id');
              if (id) {
                if (!engine.remove(id)) return sendJson(res, 404, { error: `no alert with id ${id}` });
              } else {
                engine.clear();
              }
              return sendJson(res, 200, { ok: true, remaining: engine.list().length });
            }

            if (req.method === 'POST') {
              let body: unknown;
              try {
                body = await readJson(req);
              } catch (e) {
                return sendJson(res, 400, { error: (e as Error).message });
              }
              // Default asset and mid come from the chart the user is looking at.
              const current = (await requestSnapshot()) ?? snapshot;
              const asset = (body as { asset?: string } | undefined)?.asset || current?.asset || null;
              // refPrice and the default direction come from a fresh mid (feed or info API);
              // the chart's mid is the fallback. With none of them the alert is refused.
              const mid = (asset ? await engine.freshMid(asset) : null)
                ?? (current && current.asset === asset && Number.isFinite(current.mid) ? current.mid : null);
              try {
                const { alert, existing } = engine.add(body, { defaultAsset: current?.asset ?? null, mid });
                return sendJson(res, 200, {
                  ok: true,
                  existing,
                  alert,
                  wait: `node scripts/hl-alert-wait.mjs ${alert.id}`,
                });
              } catch (e) {
                if (e instanceof AlertValidationError) return sendJson(res, 400, { error: e.message });
                throw e;
              }
            }
            return sendJson(res, 405, { error: `method ${req.method} not allowed` });
          }

          if (url.pathname.startsWith('/api/ai/trades')) {
            const id = url.searchParams.get('id') ?? '';
            const sub = url.pathname.slice('/api/ai/trades'.length);

            if (sub === '/wait' && req.method === 'GET') {
              const timeout = Math.min(30, Math.max(0, Number(url.searchParams.get('timeout') ?? 30) || 0));
              const t = await desk.wait(id, timeout * 1000);
              if (SIM && t) {
                sim.event('trade', { id: t.id, status: t.status, action: describeAction(t.action), result: t.result?.message });
                sim.wake(id, 'trade');
              }
              if (t === undefined) return sendJson(res, 404, { error: `no proposal with id ${id}` });
              if (t === null) return sendJson(res, 200, { status: desk.get(id)?.status ?? 'pending' });
              return sendJson(res, 200, { status: t.status, trade: t });
            }

            if (sub === '' && req.method === 'GET') return sendJson(res, 200, tradesPayload());

            if (sub === '' && req.method === 'DELETE') {
              const t = desk.withdraw(id);
              if (!t) return sendJson(res, 409, { error: `no pending proposal with id ${id}`, trade: desk.get(id) ?? null });
              return sendJson(res, 200, { ok: true, trade: t });
            }

            if (req.method !== 'POST') return sendJson(res, 405, { error: `method ${req.method} not allowed` });
            let body: unknown;
            try {
              body = await readJson(req);
            } catch (e) {
              return sendJson(res, 400, { error: (e as Error).message });
            }
            const b = (body ?? {}) as Record<string, unknown>;

            if (sub === '' && SIM && b.mode === 'live') {
              return sendJson(res, 400, { error: 'live trading is not enabled on this account; use paper' });
            }
            if (sub === '') {
              const fresh = await requestSnapshot();
              const current = fresh ?? snapshot;
              try {
                const trade = desk.propose(body, { defaultAsset: current?.asset ?? null, mode: current?.mode ?? null });
                server.config.logger.info(`[hl-ai trades] proposed ${trade.id} (${trade.mode}): ${describeAction(trade.action)}`);
                const warnings: string[] = [];
                if (!fresh) warnings.push(current ? 'the page did not answer just now; the proposal waits until a chart tab is open' : 'no chart connected; the proposal waits until the user opens the app');
                if (current && current.mode !== trade.mode) warnings.push(`the page is in ${current.mode} mode; the user must switch to ${trade.mode} to confirm`);
                return sendJson(res, 200, { ok: true, trade, warnings });
              } catch (e) {
                if (e instanceof TradeValidationError) return sendJson(res, 400, { error: e.message });
                throw e;
              }
            }

            if (sub === '/claim') {
              const r = desk.claim(id, b.decidedBy === 'auto' ? 'auto' : 'user');
              return r.ok ? sendJson(res, 200, r) : sendJson(res, 409, r);
            }
            if (sub === '/result') {
              const t = desk.finish(id, b);
              if (!t) return sendJson(res, 409, { error: `proposal ${id} is not executing` });
              server.config.logger.info(`[hl-ai trades] ${t.id} ${t.status}: ${t.result?.message}`);
              return sendJson(res, 200, { ok: true, trade: t });
            }
            if (sub === '/reject') {
              const t = desk.reject(id, typeof b.reason === 'string' ? b.reason : undefined);
              if (!t) return sendJson(res, 409, { error: `no pending proposal with id ${id}` });
              return sendJson(res, 200, { ok: true, trade: t });
            }
            return sendJson(res, 404, { error: 'unknown trades endpoint' });
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

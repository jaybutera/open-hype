import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import { Bars30Recorder } from './bars30.ts';

/**
 * Serves 30s candles recorded by bars30.ts (Hyperliquid has no sub-minute candles).
 *
 *   GET /api/bars30?coin=BTC[&from=ms][&to=ms][&limit=n] -> { coin, since, bars: CandleData[] }
 *
 * The first request for a coin starts recording it; `since` is the open time
 * of the oldest bar on file. Sims (SIM=1) do not record.
 */
export function bars30Plugin(): Plugin {
  let rec: Bars30Recorder | null = null;
  return {
    name: 'hl-bars30',
    configureServer(server) {
      if (process.env.SIM === '1') return;
      rec = new Bars30Recorder(
        process.env.HL_BARS30_DIR || resolve(server.config.root, '.hl-bars30'),
        msg => server.config.logger.info(`[bars30] ${msg}`),
      );
      rec.start();
      server.httpServer?.on('close', () => rec?.stop());
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/bars30') || req.method !== 'GET') return next();
        const q = new URL(req.url, 'http://x').searchParams;
        const coin = q.get('coin') ?? '';
        res.setHeader('content-type', 'application/json');
        if (!rec!.isValidCoin(coin)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'coin required' })); return; }
        const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
        const limit = Math.max(1, Math.min(5000, num('limit', 1000)));
        const { bars, since } = rec!.get(coin, num('from', 0), num('to', Date.now() + 60_000), limit);
        res.end(JSON.stringify({ coin, since, bars }));
      });
    },
  };
}

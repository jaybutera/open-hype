import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { Agent, fetch as undiciFetch } from 'undici';

// Yahoo returns very large Set-Cookie + CSP headers; default 16KB undici buffer overflows.
const bigHeaderAgent = new Agent({
  maxHeaderSize: 128 * 1024,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

const fetch2 = ((url: unknown, init?: unknown) =>
  undiciFetch(url as Parameters<typeof undiciFetch>[0], {
    ...((init as object) || {}),
    dispatcher: bigHeaderAgent,
  } as Parameters<typeof undiciFetch>[1])) as typeof undiciFetch;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface HandshakeState {
  cookie: string;
  crumb: string;
  fetchedAt: number;
}

let cached: HandshakeState | null = null;

async function doHandshake(): Promise<HandshakeState> {
  const r1 = await fetch2('https://finance.yahoo.com/quote/TSLA/options', {
    headers: {
      'User-Agent': UA,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  const rawSetCookies: string[] = [];
  const headersAny = r1.headers as unknown as {
    getSetCookie?: () => string[];
    get: (name: string) => string | null;
  };
  if (typeof headersAny.getSetCookie === 'function') {
    rawSetCookies.push(...headersAny.getSetCookie());
  } else {
    const sc = headersAny.get('set-cookie');
    if (sc) rawSetCookies.push(sc);
  }
  const cookiePairs = rawSetCookies
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean);
  const cookie = cookiePairs.join('; ');
  if (!cookie) throw new Error(`no cookies from yahoo (status ${r1.status})`);

  const r2 = await fetch2('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': UA,
      Accept: '*/*',
      Cookie: cookie,
    },
  });
  if (!r2.ok) throw new Error(`crumb fetch failed: ${r2.status}`);
  const crumb = (await r2.text()).trim();
  if (!crumb) throw new Error('empty crumb');

  return { cookie, crumb, fetchedAt: Date.now() };
}

async function getHandshake(force = false): Promise<HandshakeState> {
  if (!force && cached) return cached;
  cached = await doHandshake();
  return cached;
}

async function fetchOptions(
  symbol: string,
  date?: string,
  retry = true
): Promise<unknown> {
  const hs = await getHandshake();
  const params = new URLSearchParams({ crumb: hs.crumb });
  if (date) params.set('date', date);
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(
    symbol
  )}?${params.toString()}`;
  const r = await fetch2(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,*/*',
      Cookie: hs.cookie,
    },
  });
  if ((r.status === 401 || r.status === 429 || r.status === 403) && retry) {
    cached = null;
    return fetchOptions(symbol, date, false);
  }
  if (!r.ok) throw new Error(`yahoo options ${r.status}`);
  return r.json();
}

function yahooProxyPlugin(): Plugin {
  return {
    name: 'yahoo-options-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const m = req.url.match(/^\/api\/options\/([A-Za-z0-9._-]+)(\?.*)?$/);
        if (!m) return next();
        const symbol = m[1];
        const qs = m[2] || '';
        const dateMatch = qs.match(/[?&]date=(\d+)/);
        const date = dateMatch ? dateMatch[1] : undefined;
        try {
          const json = await fetchOptions(symbol, date);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(json));
        } catch (e) {
          const err = e as { message?: string; cause?: { message?: string } };
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: String(err?.message || e),
              cause: err?.cause ? String(err.cause.message || err.cause) : undefined,
            })
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), yahooProxyPlugin()],
  server: { port: 3000 },
});

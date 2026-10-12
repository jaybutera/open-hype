#!/usr/bin/env node
/**
 * hl-chart MCP server: lets an AI (Claude Code) read the user's open chart and
 * push overlay sets onto it. Wraps the Vite dev server's /api/ai/* routes
 * (vite-ai-plugin.ts). No dependencies: newline-delimited JSON-RPC 2.0 over
 * stdio. stdout carries protocol messages only; logs go to stderr.
 *
 * HL_FRONTEND_URL sets the dev server (default http://localhost:3000).
 */
import { createInterface } from 'node:readline';

const BASE = (process.env.HL_FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const SERVER_INFO = { name: 'hl-chart', version: '0.1.0' };

const log = (...a) => process.stderr.write(`[hl-chart-mcp] ${a.join(' ')}\n`);

/* ------------------------------------------------------------ schemas --- */

const TIME = {
  description: 'UTC ms (copy a candle\'s t), an ISO-8601 string with zone, or "YYYY-MM-DD HH:MM ET". Snapped to the bar that contains it on the chart\'s interval.',
  oneOf: [{ type: 'number' }, { type: 'string' }],
};
const TIME_OR_NOW = {
  description: 'Same as a time, or "now" to run to the right edge of the chart.',
  oneOf: [{ type: 'number' }, { type: 'string' }],
};
const COLOR = {
  type: 'string',
  description: 'Hex #rgb/#rrggbb or one of green, red, blue, yellow, orange, purple, white, gray. Defaults to the set colour.',
};
const PRICE = { type: 'number', exclusiveMinimum: 0 };
const TEXT = { type: 'string', description: 'Short on-chart text (a few words).' };

const SHAPE_SCHEMAS = [
  {
    title: 'hline: horizontal level',
    type: 'object',
    properties: {
      type: { const: 'hline' }, price: PRICE, text: TEXT, color: COLOR,
      style: { enum: ['solid', 'dashed'] },
      from: { ...TIME, description: 'Optional start time; omit for full width.' },
      to: { ...TIME_OR_NOW, description: 'Optional end time or "now"; omit for full width.' },
    },
    required: ['type', 'price'],
  },
  {
    title: 'box: zone (order block, FVG, range)',
    type: 'object',
    properties: {
      type: { const: 'box' }, t1: TIME, t2: TIME_OR_NOW, p1: PRICE, p2: PRICE, text: TEXT, color: COLOR,
    },
    required: ['type', 't1', 't2', 'p1', 'p2'],
  },
  {
    title: 'line: trendline between two points',
    type: 'object',
    properties: {
      type: { const: 'line' }, t1: TIME, p1: PRICE, t2: TIME_OR_NOW, p2: PRICE, text: TEXT, color: COLOR,
      extend: { const: 'right', description: 'Extend the line past t2 to the right edge.' },
    },
    required: ['type', 't1', 'p1', 't2', 'p2'],
  },
  {
    title: 'arrow: points at one candle/price',
    type: 'object',
    properties: {
      type: { const: 'arrow' }, time: TIME, price: PRICE, text: TEXT, color: COLOR,
      dir: { enum: ['up', 'down'], description: '"up" sits below the price pointing up (use at a low); "down" sits above pointing down (use at a high).' },
    },
    required: ['type', 'time', 'price', 'dir'],
  },
  {
    title: 'label: text at a time/price',
    type: 'object',
    properties: { type: { const: 'label' }, time: TIME, price: PRICE, text: TEXT, color: COLOR },
    required: ['type', 'time', 'price', 'text'],
  },
  {
    title: 'vline: vertical line at a time',
    type: 'object',
    properties: { type: { const: 'vline' }, time: TIME, text: TEXT, color: COLOR },
    required: ['type', 'time'],
  },
];

const TOOLS = [
  {
    name: 'get_chart_view',
    description: [
      "Read exactly what is on the user's trading chart right now (the active pane of the Hyperliquid frontend).",
      'Returns JSON: asset, interval, mode (paper/live), replay flag, mid price, the candles in the visible range,',
      "the user's position and open orders for this asset, drawn fibs, and the user's drawn trade setups.",
      'Candles are compact rows; the `columns` key names each field: [t_ms, "YYYY-MM-DD HH:MM ET", open, high, low, close, volume].',
      't_ms is the bar open in UTC ms; the ET string is the same instant in New York time (what the chart axis shows).',
      'Prices are exact; quote them rather than rounding. At most 600 candles are returned (the most recent visible);',
      '`visible.bars` is the full visible count.',
      '`setups` holds the long/short plans the user drew with "Set Up Long/Short" (side, entry, sl, tp, size, riskUsdc, rr);',
      '`pendingSetup` is a setup still being clicked in.',
      '`overlays` lists the overlay sets already pushed and whether the user has each one toggled on.',
      '`stale: true` means the page did not answer in time and this is the last view it reported.',
      'Call this before push_overlays so times and prices refer to real bars.',
    ].join(' '),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'push_overlays',
    description: [
      "Draw named overlay sets on the user's chart. Each set becomes one toggle button in the app's right column under",
      'the Buy/Sell button. Nothing is shown automatically: the user clicks a button to show that set and clicks again to hide it;',
      'several can be on at once. So split an explanation into parts the user can flip through, and push them together in one call',
      '(e.g. "OB + sweep", "Entry plan", "Invalidation"). One call = one group of buttons.',
      'Keep `name` under ~24 chars (it is the button label; max 40). Put the one-line reasoning in `description` (tooltip, max 200).',
      'Times: UTC ms (copy `t` from get_chart_view), ISO-8601 with zone, or "YYYY-MM-DD HH:MM ET"; each is snapped to the bar that',
      'contains it on the current interval. "now" is allowed for box.t2, line.t2 and hline.to.',
      'Shapes: hline {price, text?, style?, from?, to?}; box {t1, t2, p1, p2, text?}; line {t1, p1, t2, p2, extend?: "right", text?};',
      'arrow {time, price, dir: "up"|"down", text?} pointing at a candle\'s low (up) or high (down); label {time, price, text}; vline {time, text?}.',
      'Every shape takes an optional color (hex or green/red/blue/yellow/orange/purple/white/gray); otherwise the set colour is used.',
      '`asset` defaults to the charted asset. Max 40 shapes per set, 12 sets per call. `replace: true` removes previously pushed sets first.',
      'The response lists the new set ids and `warnings` (e.g. an arrow price outside its bar\'s high/low, a time outside the visible',
      'candles). Read the warnings and re-push corrected sets if they show you referenced the wrong bar. Invalid input is rejected',
      'with an error naming each problem, and nothing is stored.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        sets: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 40, description: 'Button label, under ~24 chars.' },
              description: { type: 'string', maxLength: 200, description: 'One-line reasoning, shown as the tooltip.' },
              asset: { type: 'string', description: 'Defaults to the charted asset.' },
              color: COLOR,
              shapes: { type: 'array', minItems: 1, maxItems: 40, items: { anyOf: SHAPE_SCHEMAS } },
            },
            required: ['name', 'shapes'],
          },
        },
        replace: { type: 'boolean', description: 'Remove all previously pushed sets first.' },
      },
      required: ['sets'],
    },
  },
  {
    name: 'clear_overlays',
    description: 'Remove pushed overlay sets from the chart: one set when `id` is given (ids come from push_overlays or get_chart_view.overlays), otherwise all of them.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Set id to remove; omit to remove all.' } },
      additionalProperties: false,
    },
  },
];

/* ---------------------------------------------------------------- http --- */

async function http(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`cannot reach the frontend dev server at ${BASE} (${e?.cause?.code || e.message}). Is \`npm run dev\` running? Set HL_FRONTEND_URL if it is on another port.`);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    // Vite's SPA fallback answers unknown routes with index.html and a 200,
    // which means the server on BASE is a checkout without the /api/ai plugin.
    throw new Error(`the dev server at ${BASE} answered ${path} with ${res.headers.get('content-type') || 'non-JSON'}, not JSON. It is probably a checkout without the AI overlay routes; run \`npm run dev\` from the ai-overlays branch, or set HL_FRONTEND_URL to that server.`);
  }
  return { status: res.status, json };
}

function compactView(view) {
  const { candles = [], ...rest } = view;
  return {
    ...rest,
    columns: ['t_ms', 'et', 'o', 'h', 'l', 'c', 'v'],
    candles: candles.map(c => [c.t, c.et, c.o, c.h, c.l, c.c, c.v]),
  };
}

const textResult = (obj, isError = false) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  ...(isError ? { isError: true } : {}),
});

async function callTool(name, args = {}) {
  if (name === 'get_chart_view') {
    const { status, json } = await http('GET', '/api/ai/view');
    if (status === 404) return textResult('No chart is connected: open the frontend in a browser (dev server ' + BASE + ') and try again.', true);
    if (status !== 200) return textResult({ status, ...json }, true);
    return textResult(compactView(json));
  }
  if (name === 'push_overlays') {
    const { status, json } = await http('POST', '/api/ai/overlays', { sets: args.sets, replace: args.replace === true });
    if (status !== 200) return textResult({ status, ...json }, true);
    return textResult({
      ...json,
      note: 'Sets are not visible until the user toggles their buttons on.',
    });
  }
  if (name === 'clear_overlays') {
    const q = args.id ? `?id=${encodeURIComponent(args.id)}` : '';
    const { status, json } = await http('DELETE', `/api/ai/overlays${q}`);
    return textResult({ status, ...json }, status !== 200);
  }
  throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
}

/* ------------------------------------------------------------- jsonrpc --- */

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

let toolQueue = Promise.resolve();

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: 'Reads the user\'s open Hyperliquid chart (get_chart_view) and pushes toggleable overlay sets onto it (push_overlays).',
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        if (!TOOLS.some(t => t.name === name)) return fail(id, -32602, `unknown tool: ${name}`);
        // Run tool calls one at a time, in arrival order (a push then a clear must not race).
        const run = toolQueue.then(() => callTool(name, params?.arguments || {}));
        toolQueue = run.catch(() => {});
        try {
          return reply(id, await run);
        } catch (e) {
          return reply(id, textResult(String(e.message || e), true));
        }
      }
      default:
        if (isRequest) return fail(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    log('error', e?.stack || e);
    if (isRequest) fail(id, -32603, String(e?.message || e));
  }
}

const pending = new Set();
const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  const p = handle(msg).finally(() => pending.delete(p));
  pending.add(p);
});
// Finish in-flight requests (e.g. piped input) before exiting.
rl.on('close', async () => {
  await Promise.allSettled([...pending]);
  process.exit(0);
});
log(`ready, frontend ${BASE}`);

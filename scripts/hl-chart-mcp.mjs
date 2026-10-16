#!/usr/bin/env node
/**
 * hl-chart MCP server: lets an AI (Claude Code) read the user's open chart,
 * push overlay sets onto it, arm alerts, and propose trades the user confirms
 * in the page. Wraps the Vite dev server's /api/ai/* routes
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
const WINDOW_TIME = { oneOf: [{ type: 'number' }, { type: 'string' }] };
const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M'];
const MAX_CANDLES = 1000;
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
      "the user's position and open orders for this asset (each order has an `oid` for propose_cancel / replaceOid, and `tpsl` on TP/SL triggers),",
      "drawn fibs, and the user's drawn trade setups. `trading` says whether live trading is enabled (status \"ready\") and which account orders go to.",
      '`proposals` lists recent trade proposals and their status.',
      'Candles are compact rows; the `columns` key names each field: [t_ms, "YYYY-MM-DD HH:MM ET", open, high, low, close, volume].',
      't_ms is the bar open in UTC ms; the ET string is the same instant in New York time (what the chart axis shows).',
      'Prices are exact; quote them rather than rounding. At most 600 candles are returned (the most recent visible);',
      '`visible.bars` is the full visible count.',
      '`setups` holds the long/short plans the user drew with "Set Up Long/Short" (side, entry, sl, tp, size, riskUsdc, rr);',
      '`pendingSetup` is a setup still being clicked in.',
      '`overlays` lists the overlay sets already pushed and whether the user has each one toggled on.',
      '`gex` (xyz:SP500, xyz:XYZ100 and xyz single names only, once the user has a GEX layer on) carries the GEXBot',
      'reading: spot, zeroGamma, major +/- gamma strikes by volume and OI, net GEX, and the heaviest strikes; `asOf` is its',
      'UTC ms and `offset` is already applied by the chart but not to these numbers. `gex.lookbacks` gives the major +/- volume',
      'gamma strikes 1/5 (1m pane), 5/10 (5m) or 15/30 minutes (15m and up) before `asOf`, from GEXBot\'s per-strike priors.',
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
  {
    name: 'get_gex',
    description: [
      'Dealer gamma exposure per strike from GEXBot (classic feed), via the dev server, which holds the key and caches 60s.',
      'Returns spot, zeroGamma (where net dealer gamma flips sign), the major positive/negative strikes (call wall / put wall) by',
      'volume and by OI, net GEX, and `strikes`: rows of [strike, gexVol, gexOi] sorted by strike (calls positive, puts negative,',
      'netted per strike). `vol` is from today\'s trading and moves intraday; `oi` is positions open at the start of the day.',
      '`asOf` is the reading\'s UTC ms and ET time; the feed freezes at the 16:00 ET close. Prices are cash index prices; the',
      'charted perp (xyz:SP500 -> SPX, xyz:XYZ100 -> NDX, xyz single names -> their ticker) may trade away from them after hours.',
      'Omit `ticker` to use the charted asset\'s mapping; the answer says which ticker it used.',
      '`lookbacks` rows give the major +/- volume gamma strikes N minutes before `asOf`, worked out from each strike\'s GEXBot',
      'priors (its volume GEX 1, 5, 10, 15 and 30 minutes earlier); GEXBot has no history of zero gamma or OI, and nothing',
      'older than 30 minutes. Default minutes follow the charted pane\'s interval (1m: 1,5; 5m: 5,10; 15m and up: 15,30), or',
      '15,30 with no pane. `biggestBuild` is GEXBot\'s max_priors: the strike with the biggest volume-GEX build over each window.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'GEXBot ticker (SPX, NDX, SPY, QQQ, ES_SPX, NQ_NDX, TSLA...). Default: the charted asset\'s GEXBot ticker.' },
        dte: { type: 'string', enum: ['zero', 'one', 'full'], description: 'zero = expiring today (default), one = tomorrow, full = all expirations GEXBot tracks.' },
        strikes: { type: 'string', enum: ['near', 'all', 'none'], description: 'How many strike rows: near (default) = the 40 around spot, all = every strike, none = levels only.' },
        lookbacks: { type: 'array', items: { type: 'number', enum: [1, 5, 10, 15, 30] }, maxItems: 5, description: 'Minutes back for the past major strike rows. Default: the two for the charted interval.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_candles',
    description: [
      'Read Hyperliquid mainnet candles for any asset, interval and time window, independent of the pane the user has open.',
      'Call it when you need a timeframe other than the open pane\'s (e.g. the 4h or 1d structure behind a 5m chart), another asset,',
      'or bars outside the visible range. Same compact rows as get_chart_view: `columns` names [t_ms, "YYYY-MM-DD HH:MM ET", open,',
      'high, low, close, volume]; t_ms is the bar open in UTC ms, the ET string is that instant in New York time. The last row is',
      'the bar still forming. Window: `from`/`to` (UTC ms, ISO-8601 with zone, or "YYYY-MM-DD HH:MM ET"; `to` defaults to now), or',
      '`bars` most recent bars (default 200). At most 1000 bars come back; when the window holds more, the most recent 1000 are',
      'kept and `clipped` says so. `asset` defaults to the charted asset; HIP-3 assets use "dex:COIN", e.g. "xyz:SP500".',
      'The response also carries the resolved window and the current mid.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'Defaults to the charted asset. HIP-3 assets use "dex:COIN", e.g. "xyz:SP500".' },
        interval: { enum: INTERVALS, description: 'Bar interval.' },
        from: { ...WINDOW_TIME, description: 'Window start: UTC ms, ISO-8601 with zone, or "YYYY-MM-DD HH:MM ET". Use with `to`, instead of `bars`.' },
        to: { ...WINDOW_TIME, description: 'Window end, same formats; defaults to now.' },
        bars: { type: 'integer', minimum: 1, maximum: MAX_CANDLES, description: 'Number of bars ending at `to` (default now) when `from` is not given. Default 200.' },
      },
      required: ['interval'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_alert',
    description: [
      'Arm a price alert on the dev server; it watches Hyperliquid directly, so it keeps working when the chart tab is closed.',
      'kind "cross" (default) fires on the first tick at or past `level` in `direction`; kind "close" fires when a bar on `interval`',
      'closes at or past `level` (e.g. "15m close below 82927"). `direction` defaults from the current mid (level above mid -> "above").',
      'Use exact prices from get_chart_view. A cross level already past the mid is rejected unless force: true.',
      '`asset` defaults to the charted asset. `note` (<=300 chars) is shown as the tooltip in the app; write what the level means.',
      'The alert draws as a dashed line on the chart and is listed under the AI overlays; the user can remove it there.',
      'The response includes `wait`, a command. Run it immediately with Bash run_in_background (not Monitor): it blocks until the',
      'alert fires and then exits, which re-invokes this session with the fired alert so you can read the chart and answer the user.',
      'Each alert fires once and then stays listed as fired until removed with cancel_alert.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', exclusiveMinimum: 0, description: 'Exact price.' },
        direction: { enum: ['above', 'below'], description: 'Defaults from the current mid.' },
        kind: { enum: ['cross', 'close'], description: 'Default "cross".' },
        interval: { enum: INTERVALS, description: 'Required for kind "close".' },
        asset: { type: 'string', description: 'Defaults to the charted asset.' },
        note: { type: 'string', maxLength: 300, description: 'What this level means (tooltip in the app).' },
        force: { type: 'boolean', description: 'Arm a cross alert whose level is already past the mid; it fires on the next tick.' },
      },
      required: ['level'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_alerts',
    description: 'List price alerts on the dev server, armed and fired, with ids for cancel_alert.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cancel_alert',
    description: 'Remove one alert by id (armed or fired). Omit id to remove all alerts.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Alert id from set_alert or list_alerts; omit to remove all.' } },
      additionalProperties: false,
    },
  },
];

const PROPOSE_COMMON = {
  coin: { type: 'string', description: 'Defaults to the charted asset. HIP-3 assets use "dex:COIN", e.g. "xyz:TSLA".' },
  note: { type: 'string', maxLength: 300, description: 'Why: shown on the confirm card. Name the setup and the levels.' },
  mode: { enum: ['paper', 'live'], description: 'Defaults to the mode the app is in now. The card refuses to run in the other mode.' },
  expiresInSec: { type: 'number', minimum: 30, maximum: 86400, description: 'Card disappears after this if nobody decides. Default 900.' },
};
const OID = { oneOf: [{ type: 'integer' }, { type: 'string' }], description: 'Order id from get_chart_view orders[].oid.' };
const PROPOSE_NOTE = [
  'The proposal goes to the open app, which signs it in the browser with the key it holds (live) or runs it on the paper engine',
  '(paper). By default the app sends it as soon as it arrives, with no confirm click; the user can switch that off, and then a',
  'confirm card waits under the Buy/Sell button. Treat every call as an order that will be sent. The response includes `wait`, a',
  'command: run it with Bash run_in_background so this session wakes with the outcome (done/failed with the exchange response,',
  'rejected, expired). Orders show on the chart and in the positions/orders tables like hand-placed ones; call get_chart_view',
  'after the outcome to see them. Read `warnings` (e.g. no chart open, app in the other mode: it will not run until the user switches).',
].join(' ');

const TRADE_TOOLS = [
  {
    name: 'propose_order',
    description: [
      'Propose a new order: limit (give price) or market. Size with exactly one of size (asset units), sizeUsd (notional),',
      'or riskUsd (loss if sl is hit; needs sl). Optional tp/sl attach reduce-only market triggers that activate when the entry fills.',
      'replaceOid moves an existing order: the new one is placed first, then that order is cancelled together with the TP/SL attached',
      'to it, so give tp/sl again on the new order.',
      'leverage (live only) sets the account leverage for the coin before the order. Hyperliquid minimum is $10 notional.',
      PROPOSE_NOTE,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        ...PROPOSE_COMMON,
        side: { enum: ['buy', 'sell', 'long', 'short'] },
        orderType: { enum: ['limit', 'market'], description: 'Default limit when price is given.' },
        price: { type: 'number', exclusiveMinimum: 0, description: 'Limit price; exact, from get_chart_view.' },
        size: { type: 'number', exclusiveMinimum: 0 },
        sizeUsd: { type: 'number', exclusiveMinimum: 0 },
        riskUsd: { type: 'number', exclusiveMinimum: 0 },
        tif: { enum: ['Gtc', 'Ioc', 'Alo'], description: 'Limit only. Default Gtc; Alo = post-only.' },
        reduceOnly: { type: 'boolean' },
        tp: { type: 'number', exclusiveMinimum: 0 },
        sl: { type: 'number', exclusiveMinimum: 0 },
        leverage: { type: 'integer', minimum: 1, maximum: 100 },
        replaceOid: OID,
      },
      required: ['side'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_tpsl',
    description: [
      'Propose a take-profit or stop-loss on the whole open position (reduce-only market trigger). With replaceOid it moves an',
      'existing TP/SL: the new trigger is placed first, then the old one is cancelled.',
      PROPOSE_NOTE,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { ...PROPOSE_COMMON, tpsl: { enum: ['tp', 'sl'] }, price: { type: 'number', exclusiveMinimum: 0 }, replaceOid: OID },
      required: ['tpsl', 'price'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_cancel',
    description: ['Propose cancelling open orders on a coin: listed oids, or all: true.', PROPOSE_NOTE].join(' '),
    inputSchema: {
      type: 'object',
      properties: { ...PROPOSE_COMMON, oids: { type: 'array', minItems: 1, items: OID }, all: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_close',
    description: ['Propose a market close of the whole position on a coin. For a partial close use propose_order with reduceOnly.', PROPOSE_NOTE].join(' '),
    inputSchema: { type: 'object', properties: { ...PROPOSE_COMMON }, additionalProperties: false },
  },
  {
    name: 'withdraw_proposal',
    description: 'Take back a trade proposal that is still pending (the card disappears). Fails once the user has confirmed it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Proposal id from a propose_* response.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

TOOLS.push(...TRADE_TOOLS);

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

/** Mirrors src/services/gex/symbols.ts: which GEXBot ticker a chart asset's options are on. */
const GEX_INDEX_ALIASES = { 'xyz:SP500': 'SPX', 'xyz:XYZ100': 'NDX', 'xyz:VIX': 'VIX' };
function gexTickerFor(asset) {
  if (!asset) return null;
  if (GEX_INDEX_ALIASES[asset]) return GEX_INDEX_ALIASES[asset];
  return asset.startsWith('xyz:') ? asset.slice(4) : null;
}

function etOf(ms) {
  const d = new Date(ms);
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ET`;
}

/* ------------------------------------------------------------ candles --- */

const HL_INFO = 'https://api.hyperliquid.xyz/info';
const INTERVAL_MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000,
  '1d': 86_400_000, '3d': 259_200_000, '1w': 604_800_000, '1M': 31 * 86_400_000,
};

async function hlInfo(body) {
  let res;
  try {
    res = await fetch(HL_INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(`cannot reach Hyperliquid at ${HL_INFO} (${e?.cause?.code || e.message})`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Hyperliquid info ${body.type} answered ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** New York UTC offset in ms at a UTC instant (negative: -4h in EDT, -5h in EST). */
function nyOffsetMs(ms) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {});
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** "YYYY-MM-DD HH:MM[:SS]" New York wall time -> UTC ms. Mirrors src/utils/chartTime.ts etToUtcMs. */
function etToUtcMs(wall) {
  const m = wall.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (!m) return null;
  const naive = Date.parse(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}Z`);
  if (!Number.isFinite(naive)) return null;
  const guess = naive - nyOffsetMs(naive);
  return naive - nyOffsetMs(guess);
}

/** Same rules as src/services/ai/validate.ts parseTime (the overlay times). */
function parseTime(value, field, now = Date.now()) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${field}: ${value} is not a positive number`);
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.toLowerCase() === 'now') return now;
    if (/^\d+(\.\d+)?$/.test(s)) return parseTime(Number(s), field, now);
    const et = s.match(/^(.*?)\s*(?:ET|EST|EDT|America\/New_York)$/i);
    if (et) {
      const ms = etToUtcMs(et[1]);
      if (ms !== null) return ms;
    } else {
      const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
      const ms = Date.parse(hasZone ? s : `${s.replace(' ', 'T')}Z`);
      if (Number.isFinite(ms) && /^\d{4}-\d{2}-\d{2}/.test(s)) return ms;
    }
  }
  throw new Error(`${field}: cannot read time ${JSON.stringify(value)}; use UTC ms, an ISO-8601 string with zone, or "YYYY-MM-DD HH:MM ET"`);
}

/**
 * candleSnapshot over [start, end]. Hyperliquid answers a long window with
 * only its most recent ~5000 bars, so page backwards until start is covered.
 */
async function fetchCandles(coin, interval, start, end) {
  let out = [];
  let hi = end;
  for (let page = 0; page < 20 && hi >= start; page++) {
    const rows = await hlInfo({ type: 'candleSnapshot', req: { coin, interval, startTime: start, endTime: hi } });
    if (!Array.isArray(rows) || rows.length === 0) break;
    const firstT = out.length ? out[0].t : Infinity;
    const fresh = rows.filter(r => r.t < firstT);
    if (fresh.length === 0) break;
    out = fresh.concat(out);
    if (fresh[0].t <= start) break;
    hi = fresh[0].t - 1;
  }
  return out;
}

/** Replay cursor (UTC ms) when BASE is a sim session's dev server (SIM=1), else null. */
async function simClock() {
  try {
    const { status, json } = await http('GET', '/api/sim/clock');
    return status === 200 && json?.active ? json.cursor : null;
  } catch {
    return null;
  }
}

/**
 * Sim counterpart of fetchCandles: the dev server's recorded 1m bars with
 * start <= t < end, aggregated to interval bars. end is the replay cursor, so
 * the last bar is the one still forming, as candleSnapshot returns it live.
 */
async function fetchSimCandles(coin, interval, start, end) {
  const barMs = INTERVAL_MS[interval];
  const out = [];
  let cur = Math.floor(start / barMs) * barMs;
  while (cur < end) {
    const { status, json } = await http('GET', `/api/replay/candles?coin=${encodeURIComponent(coin)}&start=${cur}&end=${end}`);
    if (status !== 200) throw new Error(`Hyperliquid info candleSnapshot answered 500: null`);
    if (!Array.isArray(json) || json.length === 0) break;
    for (const c of json) {
      const t = Math.floor(c.t / barMs) * barMs;
      const last = out[out.length - 1];
      if (last && last.t === t) {
        last.h = Math.max(last.h, Number(c.h));
        last.l = Math.min(last.l, Number(c.l));
        last.c = Number(c.c);
        last.v += Number(c.v);
      } else {
        out.push({ t, o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c), v: Number(c.v) });
      }
    }
    cur = json[json.length - 1].t + 60_000;
  }
  return out;
}

async function getCandles(args) {
  const interval = args.interval;
  if (!INTERVAL_MS[interval]) throw new Error(`interval must be one of ${INTERVALS.join(', ')}`);
  const barMs = INTERVAL_MS[interval];

  let asset = args.asset ? String(args.asset).trim() : null;
  if (!asset) {
    const view = await http('GET', '/api/ai/view');
    asset = view.status === 200 ? view.json?.asset ?? null : null;
    if (!asset) return textResult('No asset given and no chart is connected to default to; pass `asset` (e.g. "BTC" or "xyz:SP500").', true);
  }

  const simNow = await simClock();
  const now = simNow ?? Date.now();
  let to = args.to === undefined ? now : parseTime(args.to, 'to', now);
  if (to > now) to = now;
  let from;
  let wanted;
  if (args.from !== undefined) {
    from = parseTime(args.from, 'from', now);
    if (from >= to) throw new Error(`from (${new Date(from).toISOString()}) must be before to (${new Date(to).toISOString()})`);
  } else {
    wanted = Math.min(Math.max(1, Math.floor(args.bars ?? 200)), MAX_CANDLES);
    // One spare bar so the window still holds `wanted` full bars after alignment.
    from = to - (wanted + 1) * barMs;
  }
  // Never fetch far more than can be returned.
  const fetchFrom = Math.max(from, to - (MAX_CANDLES + 2) * barMs);

  let [raw, mids] = await Promise.all([
    (simNow !== null ? fetchSimCandles(asset, interval, fetchFrom, to) : fetchCandles(asset, interval, fetchFrom, to)).catch(e => {
      throw new Error(`${e.message}. Hyperliquid answers this way for an unknown coin; check "${asset}" (HIP-3 assets use "dex:COIN", e.g. "xyz:SP500").`);
    }),
    simNow !== null ? null : hlInfo(asset.includes(':') ? { type: 'allMids', dex: asset.split(':')[0] } : { type: 'allMids' }).catch(() => null),
  ]);
  if (simNow !== null && raw.length) mids = { [asset]: raw[raw.length - 1].c };

  // Bars whose open lies in the window; a from mid-bar keeps the bar containing it.
  let rows = raw.filter(r => r.t + barMs > from && r.t <= to);
  if (wanted !== undefined) rows = rows.slice(-wanted);
  // fetchFrom > from means the window was cut to the last MAX_CANDLES bars before fetching;
  // it only counts as clipped if Hyperliquid had bars before the cut.
  const clipped = rows.length > MAX_CANDLES || (args.bars ?? 0) > MAX_CANDLES
    || (fetchFrom > from && rows.length > 0 && rows[0].t <= fetchFrom + barMs);
  if (rows.length > MAX_CANDLES) rows = rows.slice(-MAX_CANDLES);

  const mid = mids && mids[asset] !== undefined ? Number(mids[asset]) : null;
  const result = {
    asset,
    interval,
    window: {
      from: { ms: from, et: etOf(from) },
      to: { ms: to, et: etOf(to) },
      ...(rows.length ? { first: { ms: rows[0].t, et: etOf(rows[0].t) }, last: { ms: rows[rows.length - 1].t, et: etOf(rows[rows.length - 1].t) } } : {}),
    },
    bars: rows.length,
    ...(mid !== null && Number.isFinite(mid) ? { mid } : {}),
    timezone: 'America/New_York',
    columns: ['t_ms', 'et', 'o', 'h', 'l', 'c', 'v'],
    candles: rows.map(r => [r.t, etOf(r.t), Number(r.o), Number(r.h), Number(r.l), Number(r.c), Number(r.v)]),
  };
  if (clipped) {
    result.clipped = `The window holds more than ${MAX_CANDLES} ${interval} bars; only the most recent ${rows.length} are returned (from ${result.window.first?.et ?? '?'}). Narrow the window or use a larger interval for earlier bars.`;
  }
  if (rows.length === 0) result.note = `Hyperliquid returned no ${interval} bars for ${asset} in this window; check the asset name (HIP-3 assets use "dex:COIN") and the times.`;
  else if (!clipped && rows[0].t > from + barMs && wanted === undefined) {
    result.note = `Hyperliquid has no ${interval} bars for ${asset} before ${result.window.first.et}; it keeps a limited history per interval, so use a larger interval for earlier bars.`;
  }
  return textResult(result);
}

const NEAR_STRIKES = 40;

/** GEXBot's raw classic response -> levels plus [strike, gexVol, gexOi] rows. */
// Plain JS copy of src/services/gex/lookbacks.ts and priorMajors in levels.ts.
/** Minutes back of each value in a strike row's priors (row[3]), in GEXBot's order. */
const GEX_PRIOR_MINUTES = [1, 5, 10, 15, 30];
/** Minutes back of each max_priors entry, in GEXBot's order. */
const GEX_MAX_PRIOR_MINUTES = [1, 5, 10, 15, 30, 60];
const GEX_LOOKBACKS = { '1m': [1, 5], '5m': [5, 10], '15m': [15, 30] };

function gexLookbackMinutes(interval) {
  return (interval && GEX_LOOKBACKS[interval]) || [15, 30];
}

/** Major +/- volume gamma strikes `minutes` before the reading, from each strike's priors. */
function gexPriorMajors(raw, minutes) {
  const slot = GEX_PRIOR_MINUTES.indexOf(minutes);
  let pos = null, neg = null, maxPos = 0, minNeg = 0;
  for (const r of raw.strikes ?? []) {
    if (!Array.isArray(r) || !Array.isArray(r[3])) continue;
    const strike = Number(r[0]);
    const v = r[3][slot] == null ? NaN : Number(r[3][slot]);
    if (!Number.isFinite(strike) || !Number.isFinite(v)) continue;
    if (v > maxPos) { maxPos = v; pos = strike; }
    if (v < minNeg) { minNeg = v; neg = strike; }
  }
  const ms = Number(raw.timestamp) * 1000 - minutes * 60_000;
  return { minutes, asOf: { ms, et: etOf(ms) }, majorPosVol: pos, majorNegVol: neg };
}

function compactGex(raw, dte, which, asset) {
  const rows = (raw.strikes ?? [])
    .filter(r => Array.isArray(r) && r.length >= 3)
    .map(r => [Number(r[0]), Number(r[1]), Number(r[2])])
    .sort((a, b) => a[0] - b[0]);
  let strikes = rows;
  if (which === 'none') strikes = [];
  else if (which !== 'all' && rows.length > NEAR_STRIKES) {
    let i = rows.findIndex(r => r[0] >= raw.spot);
    if (i < 0) i = rows.length;
    const lo = Math.max(0, Math.min(i - NEAR_STRIKES / 2, rows.length - NEAR_STRIKES));
    strikes = rows.slice(lo, lo + NEAR_STRIKES);
  }
  const ms = Number(raw.timestamp) * 1000;
  return {
    ticker: raw.ticker,
    dte,
    ...(asset ? { asset } : {}),
    asOf: { ms, et: etOf(ms) },
    spot: raw.spot,
    zeroGamma: raw.zero_gamma,
    majorPosVol: raw.major_pos_vol,
    majorNegVol: raw.major_neg_vol,
    majorPosOi: raw.major_pos_oi,
    majorNegOi: raw.major_neg_oi,
    sumGexVol: raw.sum_gex_vol,
    sumGexOi: raw.sum_gex_oi,
    biggestBuild: (Array.isArray(raw.max_priors) ? raw.max_priors : [])
      .map((p, i) => (Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])) && i < GEX_MAX_PRIOR_MINUTES.length
        ? { minutes: GEX_MAX_PRIOR_MINUTES[i], strike: Number(p[0]), gex: Number(p[1]) }
        : null))
      .filter(Boolean),
    strikesTotal: rows.length,
    columns: ['strike', 'gexVol', 'gexOi'],
    strikes,
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
  if (name === 'get_candles') return getCandles(args);
  if (name === 'get_gex') {
    let ticker = args.ticker ? String(args.ticker).toUpperCase() : null;
    let asset = null;
    // Without a ticker the view is required (unreachable server throws); with one it only supplies the interval.
    const view = ticker ? await http('GET', '/api/ai/view').catch(() => ({ status: 0, json: null })) : await http('GET', '/api/ai/view');
    const interval = view.status === 200 ? view.json?.interval ?? null : null;
    if (!ticker) {
      asset = view.json?.asset ?? null;
      ticker = gexTickerFor(asset);
      if (!ticker) return textResult(`The charted asset (${asset ?? 'none'}) has no GEXBot ticker; pass \`ticker\` (SPX, NDX, SPY, QQQ, ES_SPX, NQ_NDX, or a stock).`, true);
    }
    const dte = args.dte || 'zero';
    const { status, json } = await http('GET', `/api/gex/${encodeURIComponent(ticker)}/${dte}`);
    if (status !== 200 || json.error) return textResult({ status, ticker, dte, ...json }, true);
    const out = compactGex(json, dte, args.strikes || 'near', asset);
    const asked = Array.isArray(args.lookbacks)
      ? [...new Set(args.lookbacks.map(Number))].filter(n => GEX_PRIOR_MINUTES.includes(n)).sort((a, b) => a - b)
      : [];
    const minutes = asked.length > 0 ? asked : gexLookbackMinutes(interval);
    out.lookbacks = minutes.map(m => gexPriorMajors(json, m));
    if (interval && asked.length === 0) out.lookbackInterval = interval;
    return textResult(out);
  }
  if (name === 'clear_overlays') {
    const q = args.id ? `?id=${encodeURIComponent(args.id)}` : '';
    const { status, json } = await http('DELETE', `/api/ai/overlays${q}`);
    return textResult({ status, ...json }, status !== 200);
  }
  if (name === 'set_alert') {
    const { status, json } = await http('POST', '/api/ai/alerts', { ...args, source: 'mcp' });
    if (status !== 200) return textResult({ status, ...json }, true);
    // The wait script must reach the same server this MCP talks to.
    const wait = `HL_FRONTEND_URL=${BASE} node scripts/hl-alert-wait.mjs ${json.alert.id}`;
    return textResult({
      ...json,
      wait,
      note: `Now run \`${wait}\` with Bash run_in_background (cwd: this repo) so this session wakes when it fires.`,
    });
  }
  if (name === 'list_alerts') {
    const { status, json } = await http('GET', '/api/ai/alerts');
    return textResult({ status, ...json }, status !== 200);
  }
  if (name === 'cancel_alert') {
    const q = args.id ? `?id=${encodeURIComponent(args.id)}` : '';
    const { status, json } = await http('DELETE', `/api/ai/alerts${q}`);
    return textResult({ status, ...json }, status !== 200);
  }
  const PROPOSE_KIND = { propose_order: 'order', propose_tpsl: 'tpsl', propose_cancel: 'cancel', propose_close: 'close' };
  if (name in PROPOSE_KIND) {
    const { note, mode, expiresInSec, ...action } = args;
    const { status, json } = await http('POST', '/api/ai/trades', { action: { ...action, kind: PROPOSE_KIND[name] }, note, mode, expiresInSec });
    if (status !== 200) return textResult({ status, ...json }, true);
    const wait = `HL_FRONTEND_URL=${BASE} node scripts/hl-trade-wait.mjs ${json.trade.id}`;
    return textResult({
      ...json,
      wait,
      note: `The app sends it as soon as it can (unless the user turned auto-run off). Now run \`${wait}\` with Bash run_in_background (cwd: this repo) so this session wakes with the outcome.`,
    });
  }
  if (name === 'withdraw_proposal') {
    const { status, json } = await http('DELETE', `/api/ai/trades?id=${encodeURIComponent(args.id ?? '')}`);
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
          instructions: 'Reads the user\'s open Hyperliquid chart (get_chart_view) and candles for any asset, interval and window (get_candles), pushes toggleable overlay sets onto it (push_overlays), arms price alerts (set_alert) that wake this session when they fire, and places trades through the open app (propose_order, propose_tpsl, propose_cancel, propose_close), which signs and sends them, by default without a confirm click.',
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
  // Exit only after stdout drains; a pipe holds 64 KiB and a large reply would be cut.
  process.stdout.write('', () => process.exit(0));
});
log(`ready, frontend ${BASE}`);

# AI chart overlays

## Goal

The user talks to an AI (Claude Code in the terminal, this repo open) about trades. Today they paste
screenshots and the AI answers in prose with vague levels ("the sweep after the orderblock",
"around 84500"). Instead:

1. The AI reads what is on the user's chart right now: the exact candles in the visible range,
   the asset and interval, the user's position, open orders, drawn fibs, and the long/short trade
   setups drawn on the chart (entry / stop / target boxes from "Set Up Long" / "Set Up Short").
2. The AI pushes named overlay sets (boxes, lines, arrows, labels anchored to time and price)
   into the running app. Each set appears as a toggle button in the right column of the page,
   under the Buy/Sell button. Nothing is drawn until the user clicks a button. Clicking again
   hides it. Several sets can be on at once. One AI reply can push several sets at once.

This is NOT an in-app chatbot. There is no Anthropic API key, no chat panel, no model call from the
app. The AI the user is already talking to reaches the app through an MCP server that wraps two
HTTP routes on the Vite dev server.

## Pieces

### 1. Vite plugin: `vite-ai-plugin.ts` (repo root, next to `vite-replay-plugin.ts`)

Registered in `vite.config.ts` after `replayDataPlugin()`. Dev server only (`configureServer`).

State: the latest `ChartSnapshot` received from the page, plus the list of pushed overlay sets.

Routes:

- `GET /api/ai/view` — asks the page for a fresh snapshot over the Vite HMR websocket
  (`server.ws.send('hl-ai:snapshot-request', {})`, page replies with `hl-ai:snapshot`), waits up to
  1500 ms, returns the fresh snapshot, or the cached one with `"stale": true` if none arrives, or
  404 `{ error: 'no chart connected' }` if nothing was ever received.
- `POST /api/ai/overlays` — body `{ sets: OverlaySetInput[], replace?: boolean }`. Validates and
  normalises every set against the latest snapshot (see Validation), assigns ids and a `batch`
  id, stores them, broadcasts `hl-ai:overlays` with the full current list to every client, and
  responds `{ ok: true, sets: [{ id, name }], warnings: string[] }`. 400 with `{ error, details }`
  when a set is malformed. `replace: true` drops previously pushed sets first.
- `DELETE /api/ai/overlays` — clears all sets (or `?id=` one set), broadcasts.
- `GET /api/ai/overlays` — current list, for debugging.

Websocket events (Vite custom events, `server.ws.on` / `server.ws.send`):

- client → server `hl-ai:snapshot` `{ snapshot: ChartSnapshot }`
- server → client `hl-ai:snapshot-request` `{}`
- server → client `hl-ai:overlays` `{ sets: OverlaySet[] }`
- client → server `hl-ai:toggle` `{ id, enabled }` so the snapshot's `overlays[].enabled` is right
  (page can also just include it in the snapshot; either way the AI must be able to see which sets
  are toggled on).

Use `sendJson` style helpers like `vite-replay-plugin.ts`. Parse JSON bodies by hand (collect the
request stream), no extra deps.

### 2. Shared types and validation: `src/services/ai/`

- `types.ts` — `ChartSnapshot`, `OverlaySet`, `OverlayShape` and the input variants.
- `validate.ts` — pure functions, no DOM, no Vite: `normalizeOverlaySet(input, snapshot)` returns
  `{ set, warnings }` or throws a typed error with a message that tells the AI what was wrong.
  The Vite plugin imports this file (tsconfig includes `src` so this is also type-checked).
- `__tests__/validate.test.ts` — vitest, cover: time strings and ms both accepted, snapping to
  nearest bar, out-of-range price warning, unknown shape type rejected, bad colour rejected,
  `t2: "now"` extends to the last bar.

### 3. Page side

- `src/store/useAiOverlayStore.ts` — zustand: `sets: OverlaySet[]`, `enabledIds: string[]`,
  `connected: boolean`, `receive(sets)` (keeps enabled state for ids that still exist),
  `toggle(id)`, `remove(id)` (also DELETE on server), `clearAll()`.
- `src/services/ai/link.ts` — `startAiLink()` called once from `App.tsx` (or `AppLayout`). Guard
  `import.meta.hot`: in a production build it does nothing. Wires `import.meta.hot.on(...)` for
  `hl-ai:overlays` and `hl-ai:snapshot-request`, sends `hl-ai:snapshot` on request and once on
  start. The snapshot is built by a `snapshotProvider` registered by the chart (see below); if
  no provider is registered yet, send what the stores know with `candles: []`.
- `TradingChart.tsx` — the **active pane** registers a snapshot provider that reads
  `chart.timeScale().getVisibleLogicalRange()` and slices the candles accordingly. Also
  attaches/detaches an `AiOverlayPrimitive` per enabled set whose `asset` matches the pane's
  asset (same pattern as `tradeBoxPrimitivesRef`). User drawings (fibs and horizontal lines)
  live in `useDrawingStore` keyed by asset and persisted to localStorage (`hl-drawings`); the
  snapshot reads this asset's slice. The chart-time helpers are needed by the snapshot; move `utcToChartTime` / `getNyOffset` into
  `src/utils/chartTime.ts` and re-export from `TradingChart.tsx` so `JournalChart.tsx` and
  `ReplayControls.tsx` keep working.
- `src/components/chart/AiOverlayPrimitive.ts` — one primitive per overlay set, modelled on
  `FibPrimitive.ts`. Converts shape times (UTC ms) to chart time with `utcToChartTime` at draw
  time. zOrder `'top'` so arrows and labels sit above candles; boxes drawn with alpha fill so
  candles stay readable. Shapes:
  - `hline` `{ price, text?, color?, style?: 'solid'|'dashed', from?, to? }` — full width unless
    `from`/`to` given.
  - `box` `{ t1, t2, p1, p2, text?, color? }` — `t2` may be `"now"` (extend to right edge).
  - `line` `{ t1, p1, t2, p2, text?, color?, extend?: 'right' }` — trendline.
  - `arrow` `{ time, price, dir: 'up'|'down', text?, color? }` — a short arrow pointing AT the
    price from below (`up`) or above (`down`), text next to it. Used for "this candle / this OB".
  - `label` `{ time, price, text, color? }`.
  - `vline` `{ time, text?, color? }`.
  Colours: hex or one of `green red blue yellow orange purple white gray`. Each set gets a default
  colour from a small palette if a shape has none.
- `src/components/trading/AiOverlayPanel.tsx` — rendered at the bottom of `OrderPanel.tsx`
  (after the submit button and error/success lines). Shows nothing when there are no sets except
  a faint one-line status when not connected. Otherwise: a small heading "AI overlays", a
  "clear" ghost button, then the sets grouped by batch (one batch = one AI reply; separate
  batches with a thin divider). Each set is a toggle chip using the existing `btn-toggle` /
  `active` classes, with the set's colour as a 2px left border, the name as the label, and
  `description` as the `title` tooltip. A small `×` removes a set. Chips wrap.
- Tests: `src/store/__tests__/useAiOverlayStore.test.ts` and a render test for the panel
  (`src/components/trading/__tests__/AiOverlayPanel.test.tsx`, jsdom env via the
  `// @vitest-environment jsdom` pragma, like existing component tests under
  `src/components/positions/__tests__`).

### 4. MCP server: `scripts/hl-chart-mcp.mjs` and `.mcp.json`

Plain Node, **no dependencies**: a stdio JSON-RPC 2.0 server speaking MCP (newline-delimited
JSON on stdin/stdout, logs to stderr only). Handle `initialize` (reply with the client's
`protocolVersion`, `capabilities: { tools: {} }`, `serverInfo`), `notifications/initialized`,
`ping`, `tools/list`, `tools/call`. Unknown methods → JSON-RPC error -32601. Base URL from
`HL_FRONTEND_URL`, default `http://localhost:3000`.

Tools (write the descriptions carefully; they are the only instructions the AI gets):

- `get_chart_view` — no args. Returns the snapshot as JSON text. Candles as compact rows
  `[t_ms, "YYYY-MM-DD HH:MM ET", o, h, l, c, v]` to save tokens, with a `columns` key explaining
  the row layout. The description says: times are UTC ms and ET strings, prices are exact, the
  `setups` array holds the user's drawn long/short plans, and `overlays` lists what is already
  pushed and whether each is toggled on.
- `push_overlays` — args `{ sets: OverlaySetInput[], replace?: boolean }`. Description explains:
  each set becomes one toggle button the user clicks; nothing is shown automatically; keep
  `name` under ~24 chars; use `description` for the one-line reasoning; push several sets in one
  call when describing a play in parts (e.g. "OB + sweep", "Entry plan", "Invalidation"); times
  are UTC ms or ISO strings and are snapped to the nearest bar on the current interval; the
  response includes warnings to act on. Include the JSON schema for every shape type.
- `clear_overlays` — optional `id`.

`.mcp.json` at the repo root:

```json
{ "mcpServers": { "hl-chart": { "command": "node", "args": ["scripts/hl-chart-mcp.mjs"] } } }
```

### 5. Docs

A short section in `README.md`: start `npm run dev`, open the app, in Claude Code the `hl-chart`
MCP tools appear; example flow. Mention `HL_FRONTEND_URL` when the dev server is on another port.

## Snapshot shape

```ts
interface ChartSnapshot {
  takenAt: number;                 // ms
  mode: 'paper' | 'live';
  replay: boolean;                 // replay store active
  pane: 'primary' | 'secondary';
  asset: string;
  interval: string;                // '1m' | '5m' | ...
  timezone: 'America/New_York';    // what the `et` strings use
  visible: { from: number; to: number; bars: number };   // UTC ms of first/last visible bar
  candles: Array<{ t: number; et: string; o: number; h: number; l: number; c: number; v: number }>;
  mid: number | null;
  position: { side: 'long'|'short'; size: number; entry: number; upnl: number; liq: number | null } | null;
  orders: Array<{ side: string; type: string; price: number; size: number; reduceOnly: boolean }>;
  setups: Array<{ id: string; side: 'long'|'short'; asset: string; entry: number; sl: number; tp: number;
                  size: number; riskUsdc: number; rr: number }>;
  pendingSetup: { side: 'long'|'short'; clicks: number[] } | null;
  fibs: Array<{ id: string; p1: number; p2: number; t1: number; t2: number }>;  // t in UTC ms
  lines: Array<{ id: string; price: number; text?: string }>;   // horizontal lines the user drew
  overlays: Array<{ id: string; name: string; enabled: boolean }>;
}
```

Candle times: the chart internally shifts timestamps to ET for display (`utcToChartTime`). The
snapshot must carry real UTC ms in `t` and the ET string in `et`. Fib times stored in chart time
must be converted back to UTC (`t - getNyOffset(t)`; add a `chartTimeToUtc` helper).

Visible range: `getVisibleLogicalRange()` gives fractional indexes into the series data; clamp to
`[0, data.length-1]`, round outward. Cap at 600 bars (take the most recent) and say so in
`visible.bars` vs `candles.length`.

## Validation (server side, in `validate.ts`)

- `name` required, trimmed, ≤ 40 chars. `description` optional ≤ 200 chars. `asset` defaults to
  the snapshot's asset; a different asset is allowed but produces a warning.
- Times: number (UTC ms; if < 1e12 treat as seconds and convert) or ISO-8601 string. `"now"`
  allowed where documented. Each time is snapped to the nearest candle open in the snapshot
  (warning if moved by more than half a bar; error if no candles and the time cannot be
  snapped — in that case keep it as given).
- Prices: finite numbers > 0. For `arrow` and `label`, if the snapped bar exists and the price is
  outside `[low*0.995, high*1.005]` of that bar, keep the price but add a warning naming the bar's
  actual high/low; the AI should re-push if it meant that bar. For `box`, `p1`/`p2` ordered
  automatically.
- Colours: hex `#rgb`/`#rrggbb` or a palette name; anything else → error.
- Unknown shape `type` → error naming the allowed types. Max 40 shapes per set, 12 sets per push.
- Output `OverlaySet`: `{ id, batch, name, description?, asset, color, createdAt, shapes }` with
  all times as UTC ms numbers and every shape carrying a resolved `color`.

## Verification the implementer must do

- `npx tsc -b` clean, `npx vitest run` green.
- `npm run dev -- --port 3100`, open the page in headless Chromium (`puppeteer-core` is a
  devDependency; `/usr/bin/chromium-browser` exists), then:
  - `curl localhost:3100/api/ai/view` returns candles with sane ET strings and `setups: []`.
  - Draw a long setup via puppeteer (click "Set Up Long", three clicks on the chart), re-fetch the
    view and confirm `setups[0]` has entry/sl/tp.
  - POST two overlay sets, confirm the panel shows two chips, nothing drawn until clicked; click
    one, screenshot, confirm the shape is on the canvas (pixel check or visual); click again,
    confirm it is gone.
  - Run `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' | node scripts/hl-chart-mcp.mjs` and a `tools/list` and a `tools/call get_chart_view` through the same pipe.

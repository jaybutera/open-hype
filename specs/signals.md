# Strategy signals

A strategy runs beside the app and reports the setups it sees. Each setup shows as a card in the
right column, under the Buy/Sell button. Clicking a card draws the setup on the chart: the entry,
stop and target as a box, with whatever context the strategy sent (for v3: the swept level, the
sweep's extreme, the structure break and the entry gap). Clicking again hides it. When no pane
shows the signal's asset, the click also moves the active pane to it.

## API

The dev server (`vite-signals-plugin.ts`) keeps the list in memory. Validation and storage are in
`src/services/signals/book.ts`.

    GET    /api/signals         { signals }, newest first
    POST   /api/signals         { source, signals, replace? }
    DELETE /api/signals[?id=]   remove one signal, or all

`source` names the pusher (`v3`). A signal is upserted by `source` plus its `key`, so a later push
with the same key updates the card. With `replace: true` the array is the source's whole current
list and its other signals are dropped; a pusher that sends that on every cycle refills a restarted
dev server within one cycle. A signal the user removed with × stays out while its source keeps
sending it. Signals older than 7 days are dropped.

A signal:

| field | |
|---|---|
| `key` | required; the pusher's stable id for the setup |
| `asset` | required; a Hyperliquid coin, e.g. `xyz:SP500` |
| `entry`, `stop`, `target` | required prices; a long needs stop < entry < target |
| `time` | required; when the setup completed. UTC ms, ISO-8601, or `YYYY-MM-DD HH:MM ET` |
| `side` | `long` or `short`; default: from the stop's side of the entry |
| `tf` | timeframe label, e.g. `15m` |
| `strategy` | label; default: `source` |
| `status` | `resting` (default), `filled`, `won`, `lost`, `cancelled` |
| `statusNote` | why, e.g. `gap inverted` |
| `endTime` | when the plan ended; the setup box stops there instead of running to the right edge |
| `note` | one or two sentences, shown as the card's tooltip and returned by `get_signals` |
| `shapes` | context to draw with the setup: the shapes of `POST /api/ai/overlays` (hline, box, line, arrow, label, vline) |

Shape times are kept as sent. The chart places a time that falls between two bars of the open
interval between those bars, so a 1m time lands in the right place on a 5m pane.

    curl -X POST http://localhost:3000/api/signals -H 'content-type: application/json' -d '{
      "source": "manual", "signals": [{
        "key": "test-1", "asset": "xyz:SP500", "tf": "15m", "time": "2026-11-25 10:00 ET",
        "entry": 7050, "stop": 7070, "target": 7000,
        "shapes": [{ "type": "arrow", "time": "2026-11-25 09:40 ET", "price": 7070, "dir": "down", "text": "Sweep" }]
      }]}'

The `hl-chart` MCP server's `get_signals` returns the same list to Claude.

## The runner: `scripts/strategy-signals.py`

Runs an ict-strategies preset (default `v3/v3.toml`) on live candles. Once a minute it fetches the
closed 1m candles of the preset's assets from Hyperliquid into a parquet store (`~/.hl-signals/data`),
replays the store through the backtest engine with `--trace`, and builds the signals from the trace:

- `book.entry_placed` is a plan (entry, stop, target); `book.entry_filled`, `book.entry_cancelled`
  and `book.closed` give its status.
- `v3.gap` with outcome `plan_placed` links the plan to its setup; `v3.sweep` and `v3.break` of the
  same run give the swept level, the sweep's extreme and the swing whose break was the structure
  shift; `v3.dead` gives the reason a plan was cancelled.

A preset whose script does not trace those records still produces cards, with the setup box only.

A setup on a timeframe is seen when the first 1m bar after that timeframe's bar has closed, so a
card appears one to two minutes after the close that completed the setup. `filled` means price
reached the entry in the runner's simulated book (the preset's fill lens); it is not an order.

The replay starts at a Monday at least 28 days back, so the detector state behind a signal is the
same on every cycle within a week. Hyperliquid keeps 5000 candles per interval (about 3.5 days of
1m). Older history comes from `--seed-dir` where the collector's `{asset}_1m.parquet` files are, and
otherwise from 5m and 15m candles stored as one row per bar.

    scripts/strategy-signals.py --once --dry-run     # one cycle, print the signals
    scripts/strategy-signals.py --url http://100.117.74.55:3000

It needs `uv`, the presets (`ICT_STRATEGIES_DIR`, default `~/src/ict-strategies`) and an engine
binary built from the backtest-engine `v3` branch (`BT_BIN` or `--engine`). On box it runs as the
systemd user unit `hl-signals` (`deploy/hl-signals.service`).

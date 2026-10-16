# hl-frontend

## Talking about the chart

The `hl-chart` MCP server (`.mcp.json`, `scripts/hl-chart-mcp.mjs`) links this session to the chart the user has open in the running dev server.

- When the user asks about a trade, a setup, a level, or what they see on screen, call `get_chart_view` first instead of asking for a screenshot. It returns the visible candles with exact UTC and ET times, the position, open orders, fibs, and the long/short setups the user drew.
- Refer to bars by their ET time and exact prices from the view, never rounded levels.
- When an answer names a zone, a level, a candle, or a plan, also call `push_overlays` so the user can see it: one set per idea (for example "OB + sweep", "Entry plan", "Invalidation"), pushed together in one call. Sets appear as toggle buttons under the Buy/Sell button and draw nothing until the user clicks them. Read the warnings in the response and re-push if a price did not match the bar you meant.
- `get_candles` reads Hyperliquid mainnet candles for any asset, interval and window, whatever pane is open: pass `interval` (1m to 1M) and either `from`/`to` (UTC ms, ISO-8601 with zone, or "YYYY-MM-DD HH:MM ET"; `to` defaults to now) or `bars` (default 200). `asset` defaults to the charted asset. Rows use the same `columns` as `get_chart_view` (t_ms bar open, ET string, OHLCV), capped at 1000 bars with a `clipped` note when the window holds more. Use it for higher-timeframe structure behind the open pane, another asset, or bars outside the visible range. The MCP process calls `candleSnapshot` on api.hyperliquid.xyz directly; Hyperliquid keeps a limited history per interval (1m reaches back a few days), and the response says so in `note`.
- If `get_chart_view` reports no chart connected, tell the user to open the app at the dev server URL. The dev server runs always-on on the box machine (http://100.117.74.55:3000, systemd user unit `hl-frontend`, see `deploy/`); `.mcp.json` points the MCP server there through `HL_FRONTEND_URL`. `scripts/deploy-box.sh` restarts it on the latest master.

## GEX

`get_gex` returns GEXBot dealer gamma for the charted asset's options (`xyz:SP500` is SPX, `xyz:XYZ100` is NDX, `xyz:TSLA` is TSLA, `BTC` is IBIT rescaled to BTC prices by BTC's 1m close at the reading over IBIT spot, with the factor in `proxy`; pass `ticker` for anything else, `IBIT` for unscaled): zero gamma, the major positive/negative strikes by volume and OI, net GEX, and per-strike rows. The dev server holds the key (`GEXBOT_API_KEY` in `.env`) and caches 60s. The chart's `GEX` toolbar buttons draw the same data; `get_chart_view.gex` says what the user has on. Quote the `asOf` time when the reading is from before the current session; the feed freezes at the 16:00 ET close.

GEXBot has no history of zero gamma or OI. Each strike row carries `priors`, its volume GEX 1, 5, 10, 15 and 30 minutes earlier, and the lookbacks come only from those (`src/services/gex/lookbacks.ts`): 1m pane 1 and 5 min, 5m pane 5 and 10, 15m and up 15 and 30. With `Levels` on, the chart draws the past major +γ/-γ vol strikes as faint dotted lines from that time when they differ from now; each `γ vol` bar carries two white dots where its edge was at the two lookbacks (brighter for the shorter one), and labelled bars show the change since the longer one. `get_chart_view.gex.lookbacks` and `get_gex` `lookbacks` give the same rows, and `get_gex` `biggestBuild` is GEXBot's `max_priors` (biggest volume-GEX build over 1, 5, 10, 15, 30, 60 min).

## Price alerts

`set_alert` arms a price alert on the dev server (cross of a level, or a bar close beyond it on an interval). The dev server watches Hyperliquid itself, so the alert works with the tab closed. After `set_alert`, run the `wait` command from its response with Bash `run_in_background`; the command exits when the alert fires, which wakes this session with the fired alert. Then call `get_chart_view`, and continue the conversation with full context. Set a `note` that says what the level means. Alerts also come from the user: alt+click on the chart arms a cross alert, alt+ctrl+click a close alert on the chart's interval. `get_chart_view` lists the charted asset's alerts under `alerts`.

## Trades

`propose_order`, `propose_tpsl`, `propose_cancel` and `propose_close` send a trade to the open app, which signs it with the key it holds (live) or runs it on the paper engine (paper). By default the app runs it as soon as it arrives with no confirm click, paper or live; the user can turn that off in the "Claude trades" panel, and then each proposal waits on a confirm card. Treat every call as an order that will be sent. The dev server only stores proposals and relays the outcome; it never holds a key. Each proposal is tied to the mode the app was in when it was made and will not run in the other mode. After proposing, run the `wait` command from the response with Bash `run_in_background`; it exits with the outcome (done with the exchange response, failed, rejected, expired). Use order ids from `get_chart_view` `orders[].oid` for cancels and `replaceOid`. Give the reasoning in `note`, with exact levels.

Design notes are in `specs/ai-overlays.md`.

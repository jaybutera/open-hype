# hl-frontend

## Talking about the chart

The `hl-chart` MCP server (`.mcp.json`, `scripts/hl-chart-mcp.mjs`) links this session to the chart the user has open in the running dev server.

- When the user asks about a trade, a setup, a level, or what they see on screen, call `get_chart_view` first instead of asking for a screenshot. It returns the visible candles with exact UTC and ET times, the position, open orders, fibs, and the long/short setups the user drew.
- Refer to bars by their ET time and exact prices from the view, never rounded levels.
- When an answer names a zone, a level, a candle, or a plan, also call `push_overlays` so the user can see it: one set per idea (for example "OB + sweep", "Entry plan", "Invalidation"), pushed together in one call. Sets appear as toggle buttons under the Buy/Sell button and draw nothing until the user clicks them. Read the warnings in the response and re-push if a price did not match the bar you meant.
- If `get_chart_view` reports no chart connected, tell the user to open the app at the dev server URL. The dev server runs always-on on the box machine (http://100.117.74.55:3000, systemd user unit `hl-frontend`, see `deploy/`); `.mcp.json` points the MCP server there through `HL_FRONTEND_URL`. `scripts/deploy-box.sh` restarts it on the latest master.

## Price alerts

`set_alert` arms a price alert on the dev server (cross of a level, or a bar close beyond it on an interval). The dev server watches Hyperliquid itself, so the alert works with the tab closed. After `set_alert`, run the `wait` command from its response with Bash `run_in_background`; the command exits when the alert fires, which wakes this session with the fired alert. Then call `get_chart_view`, and continue the conversation with full context. Set a `note` that says what the level means. Alerts also come from the user: alt+click on the chart arms a cross alert, alt+ctrl+click a close alert on the chart's interval. `get_chart_view` lists the charted asset's alerts under `alerts`.

Design notes are in `specs/ai-overlays.md`.

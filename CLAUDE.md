# hl-frontend

## Talking about the chart

The `hl-chart` MCP server (`.mcp.json`, `scripts/hl-chart-mcp.mjs`) links this session to the chart the user has open in the running dev server.

- When the user asks about a trade, a setup, a level, or what they see on screen, call `get_chart_view` first instead of asking for a screenshot. It returns the visible candles with exact UTC and ET times, the position, open orders, fibs, and the long/short setups the user drew.
- Refer to bars by their ET time and exact prices from the view, never rounded levels.
- When an answer names a zone, a level, a candle, or a plan, also call `push_overlays` so the user can see it: one set per idea (for example "OB + sweep", "Entry plan", "Invalidation"), pushed together in one call. Sets appear as toggle buttons under the Buy/Sell button and draw nothing until the user clicks them. Read the warnings in the response and re-push if a price did not match the bar you meant.
- If `get_chart_view` reports no chart connected, tell the user to open the app at the dev server URL. `HL_FRONTEND_URL` points the MCP server at a dev server on a port other than 3000.

Design notes are in `specs/ai-overlays.md`.

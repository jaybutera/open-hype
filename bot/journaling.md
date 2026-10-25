# Journal

Write the journal to `{{RUN_DIR}}/journal.md`. Append; never rewrite earlier
entries. Every entry starts with the current chart time in ET, taken from the
latest tool output, not from your own clock.

Entries, in the order a session produces them:

1. **Session open**: the bias, the level list with prices and names, the draw,
   whether GEX answered, and which alerts were armed at which prices.
2. **Wake**: on every alert or wake-up, which level fired, what the bar at the
   level looked like, and which model checklist step you are at. One short
   paragraph.
3. **Setup check**: the full numbered checklist from `models/` with every
   line filled, or the first line that could not be filled and why. One per
   attempt at a level.
4. **Order**: the exact order you proposed (side, size, price, stop, target),
   the R multiple, and the proposal outcome when its `wait` returns.
5. **Management**: every change to a stop or target, with the structure point
   that justified it.
6. **Session close**: realised PnL from the fills, each trade's planned R and
   realised R, which checklist lines were weakest in hindsight, and what the
   chart did at the levels you did not trade. Keep this factual; it is read to
   improve these instructions, so a wrong guess about why a trade failed is
   worse than "unknown".

Write the open entry before arming the first alert, and the close entry before
your last turn ends. If the session ends with a position open, say so and give
the unrealised PnL at the last mid.

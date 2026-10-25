# Method: top down (v2)

v1 plus: structure alerts so the bot cannot sleep through a session, and
intraday levels once cash is open.

Work from the higher timeframes to the lower ones, and write each step's result
in the journal before taking the next. A step with nothing written is a step
not done.

## 1. Daily and 4h: bias and the levels that matter

Pull daily and 4h candles with `get_candles` (at least 60 bars each). Write:

- The bias: the direction of the last 4h break of structure, and whether the
  daily agrees. If daily and 4h disagree, the bias is "none" and you trade only
  with the 4h direction at 4h levels.
- The level list, each with its exact price and what it is: prior day high and
  low, the current week's high and low, the most recent 4h swing high and low,
  any equal highs or lows (two or more wicks within a few points), the
  overnight (18:00 to 09:30 ET) high and low, and the major gamma strikes and
  zero gamma when GEX answers.
- The draw: which level on the opposite side of the bias price is most likely
  heading for. This is where targets come from.

## 2. 1h and 15m: structure into the levels

For the two or three levels nearest to price, pull 15m candles and write:

- Whether price is approaching the level with momentum (large bodies, little
  overlap) or grinding into it (small bodies, overlapping). Momentum into a
  level sweeps it; a grind usually front-runs it.
- The last 15m swing that a reversal would have to break for a market
  structure shift on that timeframe.

Arm one alert per level that matters, with a `note` naming the level and what
you expect there. Then wait. Do not drop to 5m or 1m before an alert fires.

Alerts are the only thing that wakes you, so never idle with alerts only at
levels far from price. Always arm, as well as the level alerts, a cross alert
at the nearest 15m swing high above price and the nearest 15m swing low below
it. When one of those fires, re-read 15m, note the new structure in the
journal, re-arm at the next swings, and check whether the level list has
changed. A session in which no alert fires before 10:00 ET is a session set up
wrong.

Once the cash session is open, the level list grows. After the 09:35 ET close
the opening range high and low (the 09:30 5m bar) are levels. From then on the
session high and low are levels too, and a sweep of either counts for the
model. Arm alerts at them as they form. Levels from the daily and 4h still
rank above them for targets.

## 3. 5m and 1m: the entry

Only once price is at a level. Pull 5m and 1m candles covering the approach
and work the checklist in `models/`. The entry timeframe is 5m by default; use
1m only to refine the entry inside a 5m setup, never to invent one.

If the checklist does not complete, write what is missing, re-arm the alert
if the level is still live, and go back to waiting.

## 4. Managing

Once in a trade you watch the entry timeframe only. Re-read the higher
timeframes at the next 15m close, not sooner. Exit rules are in `core.md`;
do not invent new ones mid-trade.

# Method: top down (v3)

v2 with one direction rule: the 4h decides, the daily is context.

Work from the higher timeframes to the lower ones, and write each step's result
in the journal before taking the next. A step with nothing written is a step
not done.

## 1. Daily and 4h: direction and the levels that matter

Pull daily and 4h candles with `get_candles` (at least 60 bars each). Write:

- The 4h direction: up after the last 4h close above a 4h swing high, down
  after the last 4h close below a 4h swing low, whichever came later. This is
  the only direction you trade in today, at any level. Note whether the daily
  agrees; when it does not, expect the run to be shorter and take the first
  level as the target, but still trade.
- The level list, each with its exact price and what it is: prior day high and
  low, the current week's high and low, the most recent 4h swing high and low,
  any equal highs or lows (two or more wicks within a few points), the
  overnight (18:00 to 09:30 ET) high and low, and the major gamma strikes and
  zero gamma when GEX answers. Every level is a candidate for a sweep from
  either side; a prior day high can be swept from above as support.
- The draw: which level in the 4h direction price is most likely heading for.
  This is where targets come from.

## 2. 1h and 15m: structure into the levels

For the two or three levels nearest to price, pull 15m candles and write:

- Whether price is approaching the level with momentum (large bodies, little
  overlap) or grinding into it (small bodies, overlapping). Momentum into a
  level sweeps it; a grind usually front-runs it.
- The average 5m body of the last 20 bars, so the displacement threshold is
  ready before a sweep happens. Refresh it when a sweep bar closes.

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
and work the checklist in `models/`. The entry timeframe is 5m; 1m is for
reading the bar that reached the level while it forms, never for a setup of
its own.

When a bar wicks through a level, arm a 5m close alert back on the original
side of it so the close that makes it a sweep wakes you, and keep the alert
armed while bars close beyond the level: the close that ends a failed break is
a sweep too. When a sweep bar has closed, arm a 5m close alert beyond the sweep
bar's far extreme; that close is the candidate displacement. Read it, check the
body and the gap once the next bar has closed, and arm the entry alert at the
gap's near edge.

A level is never used up. When an attempt dies (three bars and no
displacement, or the wick taken), the level stays on the list and the next 5m
close back across it starts a fresh attempt with its own sweep bar and its own
wick; the earlier bars play no part. While price trades around a level, the
5m close alerts on both sides of it are the wake: keep them armed the whole
time, not only during an attempt. A cross alert at a level that price is
chopping across is re-armed once per 5m close, not on every tick; the sweep
is decided at the close, so nothing is lost by waiting for it. Watch every
level price is near, not just the one of the last attempt. On 2026-07-08 the bot read one failed attempt at the session high and
then slept through a failed break of the opening range high two bars later
that displaced, left a gap and ran 2R.

If the checklist does not complete, write what is missing, re-arm the alert
if the level is still live, and go back to waiting.

## 4. Managing

Once in a trade you watch the entry timeframe only. Re-read the higher
timeframes at the next 15m close, not sooner. Exit rules are in `core.md`;
do not invent new ones mid-trade.

# Method: top down (v4)

v3 with the direction taken from the daily, the GEX regime read as part of
the bias, the entry read on 1m, and the alerts cut to the trade side.

Work from the higher timeframes to the lower ones, and write each step's
result in the journal before taking the next.

## 1. Direction and levels, before 09:30

Pull daily and 4h candles with `get_candles` (at least 60 bars each). Write:

- The direction: the daily's. Up after the last daily close above a daily
  swing high, down after the last daily close below a daily swing low,
  whichever came later. This is the only direction you trade today, at any
  level. The 4h says where in the daily leg price is: with the daily, price
  is expanding and the draw is the next daily level; against it, price is
  retracing, and the setup to wait for is the one that ends the retrace (in a
  down daily, a displacement down from a high). On 2026-10-16 a 4h-only read
  said up on a day the daily said down and the market fell 125 points; the
  4h does not set the direction.
- The level list, each with its exact price and what it is: prior day high
  and low, the week's high and low, the last 4h swing high and low, equal
  highs or lows (two or more wicks within a few points), the overnight (18:00
  to 09:30 ET) high and low, and the major gamma strikes and zero gamma when
  GEX answers. Split it: the entry levels are the ones on the trade side (in
  a down direction, the highs above price, and each level price gives up on
  the way down); the levels on the other side are the draw and the targets.
- The draw: the level in the direction price is most likely heading for.

## 2. GEX regime, 09:35 and 09:55

Read `get_gex` at 09:35 and again twenty minutes later; the first reading's
net vol is provisional. Write: price above or below zero gamma, the sign of
net GEX, the major positive and negative strikes by vol and by OI, the put
and call walls. Then the regime:

- Negative gamma, price below zero gamma: moves extend. The session's shape
  is the break: levels in the daily direction give way with displacement and
  the entry is the retrace into the gap the break left. Sweeps against the
  direction fail fast; do not buy them.
- Positive gamma, price above zero gamma: moves revert. The shape is the
  sweep: a level is run and displaced back from. Targets are the major
  strike and zero gamma, not open air.
- Regime against the daily (positive gamma on a down daily, or the reverse):
  only setups at daily or 4h levels, with the first level or strike in the
  way as the target; under 1.5R, no trade.

Re-read GEX after each fill and when price reaches a major strike, otherwise
not more than every 30 minutes. One reading changes nothing; two readings
that agree change the regime.

## 3. Alerts

Arm one cross alert per entry level within the day's reach, and one at the
draw, each with a `note` naming the level and what you expect there. Add one
cross alert at the nearest 15m swing on the trade side (the swing high above
price in a down direction) as the structure wake, re-armed once per 15m
close, not per 5m bar. After the 09:35 close add the opening range extreme on
the trade side; later, the session extreme on the trade side once price has
turned from it. That is the whole set.

Closes beyond a level do not need an alert of their own: when a wake comes,
count them from the candles. Do not arm an alert at a level price is chopping
across; wait for it to leave. A full session needs 20 to 30 wakes. The v4
profile spent 65 to 80 wakes and $31 to $33 a session counting closes on
levels that were breaking; if you have armed more than ten alerts in an hour
you are polling. Between 12:00 and 13:30 keep the level alerts and the draw
only.

## 4. The entry, 5m and 1m

When a wake comes at a level, pull the 5m bars of the approach and the 1m
bars of the last fifteen minutes and ask one question: is there a
displacement in the daily direction, as the model defines it? If not, write
the level's state in one line (held, swept, broken, and by which closes) and
go back to waiting on the same alert. If yes, find the gap, fill the
checklist in `models/`, place the order, and arm the alerts the checklist
names.

Do not drop to 1m before a wake at a level. The 1m is for the bar that is
reaching the level and for the gap inside a displacement leg, never for a
setup of its own away from a level.

## 5. Managing

Filled, you watch the 5m only. The stop is structural and does not move
until price has gone 1R in your favour, and then only behind a completed 5m
swing. Do not trail after a single impulse bar: on 2026-10-16 the baseline's
13:40 long was trailed under a one-bar spike and stopped at -0.26R while the
structural stop was never touched. Do not pull the target forward. Re-read
the higher timeframes at the next 15m close, not sooner. After the second
losing trade, stop trading and write the close entry.

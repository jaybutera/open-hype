# Method: top down (v6)

v5 with the walls read from the session's GEX history and the retrace given
the time it takes. The trade side comes from the GEX regime; the daily sets
the levels and the draw.

Work from the higher timeframes to the lower ones, and write each step's
result in the journal before taking the next.

## 1. Context and levels, before 09:30

Pull daily and 4h candles with `get_candles` (at least 60 bars each). Write:

- The daily direction: up after the last daily close above a daily swing
  high, down after the last daily close below a daily swing low, whichever
  came later. It is context, not the side you trade. On the eleven GEX days
  from 2026-10-15 to 10-29 this rule said down every day and the cash session
  closed above its open on seven of them; a profile locked to it was short
  only through a 175-point rally. The 4h says where in the daily leg price
  is: with the daily, price is expanding; against it, retracing.
- The level list, each with its exact price and what it is: prior day high
  and low, the week's high and low, the last 4h swing high and low, equal
  highs or lows (two or more wicks within a few points), the overnight (18:00
  to 09:30 ET) high and low, and the major gamma strikes and zero gamma when
  GEX answers. Keep every level on both sides until the side is known.
- The draws: the next level above and the next level below that price is
  likely heading for, one each.

Before the side is set there is nothing to trade. Arm the structure wakes
(the nearest 15m swing on each side) and the 09:35 timer and wait.

## 2. The side, from the GEX regime

Read `get_gex` at 09:35 and again at 09:55; the 09:35 net vol is provisional.
Timers in this session are 5m close alerts (arm a 5m close alert and treat
its fire as the timer; a shell sleep does not wake the session on time).
Write each time: spot against zero gamma, the sign of net vol GEX and of net
OI GEX, the major positive and negative strikes by vol and by OI. The OI
majors are the put wall and the call wall. A vol major is a wall too when it
has held the same strike over two or more of the session's reads and carries
the biggest builds (`biggestBuild` and the heaviest strike rows): on
2026-10-22 the -vol strike was 7650 at every read from 09:35 to the close,
price fell 50 points onto it and then pinned within 15 points of it for five
hours; a short sold 6 points above it was stopped on the retrace. A vol
major that moved to the nearest strike since the last read is not a wall (on
2026-10-16 the -vol strike was 7730, 7735, 7720, 7700, 7650 and 7640 across
the day); it is a level and a target. Write at each read which kind each vol
major is.

The regime, and with it the side:

- Price below zero gamma and net vol GEX negative: negative gamma. Moves
  extend downward. The side is short, the shape is the break: a level gives
  way with displacement and the entry is the retrace into the gap it left.
  The retrace can take hours (on 2026-10-22 the 10:20 break of the equal
  lows was retraced at 12:20; on 2026-10-16 the 09:30 break of the prior day
  high at 10:50) and runs toward zero gamma and the OI put wall, which is
  where the stop goes. Targets are the vol wall and the levels below; the
  sells that paid on both days were sold on the retrace with the wall as the
  target, not at the wall. Sweeps of highs are not bought.
- Price above zero gamma and net vol GEX positive: positive gamma. Dips are
  bought and the market grinds toward the call wall. The side is long, the
  shape is the sweep: a low is run and displaced back from, or a high is
  broken with displacement and retested. Targets are the +vol strike, the
  call wall and zero gamma's distance above, not open air; in this regime
  the afternoon gives the morning back more often than not (10-19, 10-23,
  10-26), so a long late in the session takes the first strike in the way.
- Price within a few points of zero gamma, or price on one side with the
  net vol sign saying the other: no regime. No side, no trade. Keep the
  alerts, wait for the next read.

The side is set when two readings twenty minutes apart agree, so the
earliest side is 09:55. It changes the same way: two later readings that
agree on the other regime flip it, and a position already on stays with its
stop and target. Re-read GEX after each fill, when price reaches a major
strike or zero gamma, and otherwise every 30 minutes. When the side agrees
with the daily direction every level on the list qualifies; when it
disagrees, the setup must be at a daily or 4h level, an OI wall or zero
gamma, with the first level in the way as the target.

When `get_gex` is unavailable all day there is no side from the regime; fall
back to the daily direction at daily and 4h levels only, and say so once in
the journal.

## 3. Alerts

Once the side is set, arm one cross alert per entry level within the day's
reach on the trade side, and one at the draw on the other side, each with a
`note` naming the level and what you expect there. Add one cross alert at
the nearest 15m swing on the trade side as the structure wake, re-armed once
per 15m close, not per 5m bar. After the 09:35 close add the opening range
extreme on the trade side; later, the session extreme on the trade side once
price has turned from it. That is the whole set.

Closes beyond a level do not need an alert of their own: when a wake comes,
count them from the candles. Do not arm an alert at a level price is chopping
across; wait for it to leave. A full session needs 20 to 30 wakes; the v5
profile did 2026-10-16 in 28 wakes for $16.63 and that is the budget. If you
have armed more than ten alerts in an hour you are polling.

## 4. The entry, 5m and 1m

When a wake comes at a level, pull the 5m bars of the approach and the 1m
bars of the last fifteen minutes and ask one question: is there a
displacement on the trade side, as the model defines it? If not, write the
level's state in one line (held, swept, broken, and by which closes) and go
back to waiting on the same alert. If yes, find the gap, fill the checklist
in `models/`, place the order, and arm the alerts the checklist names.

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

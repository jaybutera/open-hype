# Handoff: making the 2022 model trade (branch bot-v4)

Written 2026-10-27, rewritten 2026-10-28, so the work can continue after a
context reset. Everything below is in this branch; `git log master..bot-v4`
lists the commits.

## Goal

The user's ask: the baseline (profile `none`, one-line prompt plus memory seed)
trades and roughly breaks even; profiles 2022-v1 to v3 never placed an order
in six runs. Improve the model profile's performance in the sim, in the ICT
framework, spending sim credits sparingly. The baseline is the metric to beat.

Since 2026-10-28 the user wants tests only on days with GEX data. The GEXBot
end-of-day archive on box (`~/data/gexbot-eod/{day}/{TICKER}.zip`, nightly
since 2026-10-15) is served to sims by `gex-archive.ts` through
`vite-gex-plugin.ts`: the record at the replay cursor, the previous close
before 09:30 ET, 503 for days without an archive. July runs had no GEX, so
the July rows in the README scoreboard are a different test from the October
ones.

## What was found

- `scripts/bot-scan.py` applies the model mechanically to the recording
  (`~/src/ict-scanner/data/xyz:SP500_1m.parquet`; weekdays only since
  2026-10-28). The scan that chose the v3 rules read the 4h bias from the 4h
  bar still forming at 09:30 ET, so it knew the first hours of the session
  and reported +23R to +30R. Fixed, every rule set tested lands between -9R
  and +12R over 132 sessions (table in `bot/README.md`): the model as
  written has no mechanical edge in this recording, and the fees would eat
  what is there. The ranking between variants (sweep-bar shift, gap
  required, market on touch, fallback entry) still holds; it is the level,
  not the order, that changed.
- Two rules in the v2 wording blocked trades entirely: the MSS through a
  3-bar swing and the target at the nearest level >= 2R. v3 replaced them.
- The bot's 4h direction and the scan's can disagree on a day (10-16: bot
  read up, scan read down after the fix) because the bot reads any 4h swing
  while the scan uses 3-bar swings over 12 days. Neither reading has shown an
  edge, so this is not worth aligning yet.
- Cost: a full 09:00 to 16:00 ET session with v4 cost $32.89 on 10-16 (460
  tool calls, 80 wakes, 106 alerts). The method's 5m-close wakes on both sides
  of every level price trades around are what drives it on a trend day.

## Runs with GEX (recorded 2026-10-16, 09:00 to 16:00 ET)

- `2022-v4-1016`: one long 12 at 7737.2 (session equal lows 7733.4, fourth
  failed-break attempt, 0.2-point gap), stopped at 7730.1 twelve minutes
  later. Net -96.33 after fees. A trend day down against the bot's 4h-up read.
- `baseline-1016`: two shorts and one long, +69.60 gross, 33.23 fees, +36.37
  net, $18.50. It traded the short side the 4h-up rule closed to v4, read GEX
  24 times, and was done by 15:00 ET. On the one GEX day run so far the
  baseline is ahead by 132.70 net and cost $14 less.
- `2022-v4-1016-r2`: identical repeat of the first v4 run (commit f11b60f,
  same prompt). No trade, $30.86, 481 tool calls, 114 alerts. Same bias and
  level reads through 10:45; at the 10:50 bar run 1 had the session equal
  lows 7733.4 on its level list and traded their fourth sweep, run 2 tracked
  the GEX strike 7730 instead and saw no sweep bar. Eleven sweep bars, none
  followed by a displacement with a gap. Run-to-run variance on one day is
  one full trade, so a single sim day cannot rank profiles; compare over
  several GEX days or by the mechanical scan.

## 2022-v5 to v8 (2026-10-30)

Eleven sim runs on six fresh GEX days today; every one has a row in the
README scoreboard, and the regime table there is the key finding: the daily
direction rule said down on all eleven October GEX days while seven of them
closed up, so v5 was short-only through a 175-point rally. Profiles since:

- `2022-v6` (commit c314ab0): side from the GEX regime (two reads twenty
  minutes apart agreeing on which side of zero gamma price is and the net
  vol sign), OI majors as the only walls, entry at the 1m gap edge,
  continuous 09:30 to 15:30 window. Lost -1R on 10-22 selling six points
  above a vol strike that had held 7650 all day.
- `2022-v7` (3d6a555, timer recipe 08c6d6a): a vol major that holds its
  strike over two or more reads with the biggest builds is a wall; the entry
  zone is the first gap of the leg; the order rests while the regime holds
  (cancelled on a 5m close through the far edge, a regime flip, or the
  target reached unfilled). Six fresh days: -86.5 against the baseline's
  -343.3; two fills (10-29 +21.6, 10-21 -108.1), the rest refusals on line 7.
  This is the current best profile and the one to keep testing.
- `2022-v8` (db4408e): v7 with the entry at the near edge of the 5m gap
  instead of the 1m gap (v7 missed a 2.13R fill on 10-26 by 3.4 points). One
  proof run on 10-26 traded nothing because it read the morning's level
  differently; unproven, not worse.

What the six days say: the refusals on line 7 (a wall under 1.5R) are now
the whole story. In positive-gamma mornings the OI call wall below and the
vol wall above bound a 40-point band and every long setup forms in its upper
half, so the structural stop beyond the lower wall and the target at the
upper one never reach 1.5R. Fillable refusals went about +1R, +1R and -1R.
Two candidates for v9, to be tested on at least three days before either is
adopted: (a) in the sweep regime with the side against the daily, allow the
first wall as a target down to 1.2R; or (b) let the stop sit between the
sweep wick and the wall when the wall is more than three points past the
wick. Also from 10-21: a side set on net vol readings decaying toward zero
(-22.9k then -7.2k) with the biggest builds on the other side flipped within
an hour; two reads should agree in sign and the second should not be
smaller than the first.

Cost: a 09:00 to 13:00 ET v7 session is $8.6 to $10.8 (16 reads on 10-21
made it $16.3; the method says every 30 minutes, the bot read at every
timer wake). Runs on different `--port`s run in parallel on box without
interfering; four at once was fine, five pushed free memory under 3 GB.
`/tmp/hl-sim/launch.sh NAME DAY START END PROFILE PORT` and
`/tmp/hl-sim/waitrun.sh NAME` on box are the launcher and the blocking
waiter used today. The sim's paper balance is not visible to the bot through
`get_chart_view` (it assumes $10,000); worth exposing.

Two runs were still going when the session stopped: `2022-v7-1019` and
`2022-v7-1023` under `/tmp/hl-sim/` on box. Read their `journal.md` and
`paper-accounts.json`, add their rows, and run the baseline on 10-19 and
10-23 to complete the pairs.

## How to run

```
ssh box
cd ~/src/hl-frontend-bot-v4 && git fetch -q origin bot-v4 && git checkout -q --detach origin/bot-v4
export PATH="$HOME/.local/bin:$PATH"
node scripts/sim.mjs --asset xyz:SP500 --interval 5m \
  --start "2026-10-16 09:00 ET" --end "2026-10-16 16:00 ET" \
  --profile 2022-v4 --ref origin/bot-v4 \
  --prompt "Trade SP500 on the paper account this morning." \
  --out /tmp/hl-sim/2022-v4-1016 > /tmp/hl-sim/2022-v4-1016.log 2>&1
```

Baseline: `--profile none --memory-seed /home/casper/.config/hl-sim/memory-seed`
and the prompt "Trade SP500 on the paper account this morning. Watch the open
and take a setup if there is one; set alerts and wait for them instead of
polling."

Launch from a laptop with `setsid nohup ... < /dev/null &` or the ssh call
hangs. Kill with patterns that do not match their own command line
(`pkill -f "sim[.]mjs"; pkill -f "[c]laude -p"`).

`~/src/hl-frontend-bot-v4` on box is a worktree of `~/src/hl-frontend` with
`node_modules` and `.env` symlinked. `--ref origin/bot-v4` is what the agent
checks out; the profile and the dev server come from the worktree. Runs are
sequential (port 3001).

Recording: the replay parquet is pulled from the collector host with
`~/src/ict-scanner/sync-data.sh` (rsync from `pp-trader`; a targeted rsync of
`xyz:SP500_1m.parquet` alone skips the tick tree), then scp it to
`box:~/src/ict-scanner/data/`. Refreshed 2026-10-28 to cover through 10-28.

Read a run: `journal.md` (what the bot saw, each checklist), `summary.json`
(`cost`, `end.position`), `paper-accounts.json` (fills). Scoreboard in
`bot/README.md`; add a row per run.

Scan a wording change before paying for a run:
`python3 scripts/bot-scan.py ~/src/ict-scanner/data/xyz:SP500_1m.parquet '[{}, {"mingapb":0.25}]' --trades`
(defaults are the v4 rules; keys and meanings are in `run()`; `--trades`
lists each trade, which is how to pick a test day).

## What to do next

1. 10-16 is done three times (v4 twice, baseline once). Next, one run at a time, the other GEX days (10-15 and 10-19 to 10-28),
   v4 and baseline on the same day, with the cost in each row.
2. The scan says the mechanical core is break-even, so a better result has to
   come from what the scan cannot see: the GEX levels and the discretion in
   `core.md`. Read the 10-16 journals side by side for where the two profiles
   differed and move what the baseline does better into `bot/`.
3. Cut the cost of v4 before more full days: fewer 5m-close wakes away from
   an active attempt, one alert per level, and no re-reads on duplicate fires.
   A trend day through many levels should not cost $33.
4. Do not change a model rule on one trade. Check the day's scan trades
   (`--trades`) and the journal's checklist first; every loss so far had a
   mechanical reason in the wording (thin gap, counter-trend bias read).
5. Merge bot-v4 to master and run `scripts/deploy-box.sh` only when the
   profile beats the baseline on the GEX days. The sim GEX work
   (`gex-archive.ts`, `vite-gex-plugin.ts`, `specs/sim.md`) is independent of
   the bot wording and can merge first.

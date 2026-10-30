# bot

Everything that shapes how the autonomous trading agent trades lives in this
directory. Nothing else does.

## The rule

Adjustments to the bot go here, as edits to these files, committed to master.
Not into Claude auto-memory, not into a memory seed outside the repo, not into
the `--prompt` line of a run, not into CLAUDE.md. A rule that is not in `bot/`
is not part of the bot, and a run that cannot be reproduced from a commit and a
profile name is not an experiment.

The session prompt (`--prompt`) names the asset, the account and the window.
It carries no method.

## Layout

| file | concern | changes |
|---|---|---|
| `core.md` | the mandate: profit over trade count, risk, sizing, tool habits | rarely |
| `method/top-down.md` | the process: HTF bias, structure into levels, LTF entry; what each step writes down | per experiment |
| `models/2022.md` | the one setup the bot may trade, as a checklist with definitions | per experiment |
| `journaling.md` | what the bot writes to the run's journal before an order and at the close | rarely |
| `profiles/*.json` | which files make up one bot; `2022-v1` is the first, `2022-v2` adds structure alerts and intraday levels after a run that slept through 2026-07-08; `2022-v3` is v2 with the shift swing taken from inside the leg; `2022-v4` is `models/2022-v3.md` and `method/top-down-v3.md`, the rules recalibrated by the scan below; `2022-v5` is `models/2022-v4.md` and `method/top-down-v4.md`: direction from the daily and the GEX regime, displacement by eye instead of a 2x body, the gap on 5m or 1m, a resting limit in the gap, alerts on the trade side only | per experiment |
| `../scripts/bot-scan.py` | mechanical scan of the model's rules over recorded 1m candles, for checking a wording change before spending a sim run on it | per experiment |

A profile is `{ "files": [...] }`. The runner (`scripts/sim.mjs --profile NAME`)
concatenates the files in order, replaces `{{RUN_DIR}}` with the run's output
directory, and passes the text with `--append-system-prompt`. `summary.json`
records the profile name and the sha256 of the assembled text, so two runs are
comparable only when the hashes match.

To try a change, copy `profiles/2022-v1.json` to `profiles/<name>.json`, point
it at a variant file (for example `models/2022-ob-only.md`), and run the same
day set with both profiles. The variant file lives next to the original; do not
edit a file in place while a profile still under comparison points at it.

## Baseline

The baseline is the bot before `bot/` existed: the one-line prompt "Trade
SP500 on the paper account this morning. Watch the open and take a setup if
there is one; set alerts and wait for them instead of polling." with the live
memory dir as the seed and no model. Rerun it with `--profile none` and
`--memory-seed` pointing at a copy of the memory dir.

## Scoreboard

xyz:SP500, 5m pane, paper account of $10,000, sessions 09:00 to 12:00 ET
unless noted. Fees are at the HIP-3 growth-mode rates (0.3 bp maker, 0.9 bp
taker); the two 2026-10-15 runs were charged five times that before the fee
fix and are corrected here. Run dirs are on box under `/tmp/hl-sim/`.

| recording | profile | run | trades | gross | fees | net | notes |
|---|---|---|---|---|---|---|---|
| 2026-07-07 | baseline | `fable-run1` (09:05 to 10:40) | 2 shorts | +25.89 | 7.20 | +18.69 | |
| 2026-07-07 | 2022-v1 | `2022-v1-0707` | 0 | 0 | 0 | 0 | six attempts, none past displacement |
| 2026-07-08 | baseline | `fable-run2` (09:05 to 11:10) | 1 long, 1 short | +64.40 | 14.29 | +50.11 | |
| 2026-07-08 | 2022-v1 | `2022-v1-0708` | 0 | 0 | 0 | 0 | slept: all alerts outside the range, never woke |
| 2026-07-08 | 2022-v2 | `2022-v2-0708` | 0 | 0 | 0 | 0 | woke four times; PDL missed by 5.4 points |
| 2026-07-09 | baseline | `baseline-0709` | 3 longs | -59.10 | 11.47 | -70.57 | third long still open at noon, +20.10 unrealised |
| 2026-07-09 | 2022-v1 | `2022-v1-0709` | 0 | 0 | 0 | 0 | sweep and displacement found, MSS pivot definition failed |
| 2026-07-09 | 2022-v2 | `2022-v2-0709` | 0 | 0 | 0 | 0 | 14 wakes; two PDH short sweeps died at displacement; the OR-low sweep and 44-point run up was the model's shape and the bias rule excluded longs |
| 2026-07-09 | 2022-v3 | `2022-v3-0709` | 0 | 0 | 0 | 0 | 23 wakes, $11.48; 1m shift swing worked (7505.8) but neither 4h-level sweep got a displacement before the wick was taken |
| 2026-07-07 | 2022-v4 (market-on-touch entry) | `2022-v4-0707` | 0 | 0 | 0 | 0 | $27.34, 450 tool calls: the re-arm-on-fire rule woke it every minute at the ON low; 4h up so longs only, the market fell 56 points with no displacement up; correct no-trade, wrong cost |
| 2026-07-08 | 2022-v4 | `2022-v4-0708` | 0 | 0 | 0 | 0 | $5.00; 4h down, short only; the 09:45 sweep of the session high got no displacement, then the bot kept only that attempt's alert and missed the 10:00 failed break of ORH 7463.0 (10:10 body 9.9 closed below 7459.3, gap 7458.8 to 7461.1), which the scan sells at 7458.8 for 2R by 10:45 |
| 2026-07-08 | 2022-v4 | `2022-v4-0708-b` | 0 (1 order) | 0 | 0 | 0 | $9.65, rerun with the level-stays-live wording; four attempts at ORH 7463.0, the fourth completed the checklist: sell limit 7450.0 at the gap's near edge, stop 7467.5, target 7405.8 (daily low, 2.54R); price touched 7450.0 at 10:50 without trading through, order cancelled after 12 bars, unfilled; 7419.3 at 11:30 would have been 1.75R |
| 2026-07-08 (09:40 to 11:45) | 2022-v4 | `2022-v4-0708-c` | 1 short, open at the end | 0 realised, +73.28 unrealised at 11:45 (mid 7430.85) | 1.06 | +72.2 unrealised | $12.26; first fill of any model profile: ORH 7463.0 swept 10:25, displacement 10:35, gap 7450.0 to 7451.1, market entry on the 10:50 touch filled 7446.35 (3.65 through the edge, the sim fills a cross alert at the 1m bar's close), stop 7467.5, target 2R 7404.0; stop trailed to 7450.5 at 1R and 7439.1 at 1.16R behind 5m swing highs. Replay after the cutoff: the trailed stop fills at 12:05 for +7.25 points (+34.3 gross, 0.34R); the untrailed stop would have filled at 12:52 for -1R; 7404.0 was never reached (day low 7424.3) |
| 2026-07-09 | 2022-v4 (with the fallback entry) | `2022-v4-0709-c` | 1 long, open at the end | 0 realised, +72.96 unrealised at 12:00 (mid 7523.35) | 0.89 | +72.1 unrealised | $12.68; same OR low 7480.4 setup as `-b`; the gap edge 7495.7 was never touched, the fallback filled long 3.944 at 7504.85 on the 10:40 close, stop 7479.5, target 7555.5 (2R); 0.87R at the cutoff, no trailing yet. Replay to 16:00: neither stop nor target hit, close 7538.2 = +33.35 points, about +131 gross |
| 2026-07-09 | 2022-v4 (final wording) | `2022-v4-0709-b` | 0 | 0 | 0 | 0 | $10.09; 4h up, longs only; the OR low 7480.4 sweep at 10:20 completed the checklist (displacement 10:25 body 9.6, gap 7493.8 to 7495.7, stop 7479.5, target 7535 at 2.43R), entry alert armed at 7495.7 and never touched: price ran to 7524.5 by 11:20 without a retrace, setup expired at 11:30 |
| 2026-07-09 | 2022-v4 (target line still v2) | `2022-v4-0709` | 0 | 0 | 0 | 0 | $10.62; 4h read as up, long only; ORL 7480.4 sweep at 10:20 displaced with a gap and was declined on the target line (PDH 7509.2 at 0.8R); the 11:15 sweep of 7516.2 got a 7.1 body against a 10.4 threshold |
| 2026-10-16 (09:00 to 16:00) | baseline | `baseline-1016` | 2 shorts, 1 long | +69.60 | 33.23 | +36.37 | $18.50, 256 tool calls, 24 GEX reads; short 12 at 7717 (10:50 fill) covered 7703 at 11:11 for +168; short 12 at 7696 at 11:25 stopped 7702 for -72; long 12 at 7668 at 12:53 stopped 7665.8 for -26.4; finished on its own at 15:00 ET with no position |
| 2026-10-16 (09:00 to 16:00) | 2022-v4 | `2022-v4-1016` | 1 long | -85.20 | 11.13 | -96.33 | $32.89, 460 tool calls, 80 wakes; first run with GEX served from the archive (previous close before 09:30, then the day's readings). 4h read as up, so longs only, on a trend day down (7759.7 pre-market to 7630.1). Session equal lows 7733.4 were swept four times; the fourth completed the checklist with a 0.2-point gap, market long 12 at 7737.2 (margin-capped, 0.85% risk), stopped at 7730.1 twelve minutes later. Every other long level broke by four closes instead of sweeping; the short side, where the structure was, was closed by the bias rule |
| 2026-10-16 (09:00 to 16:00) | 2022-v4 | `2022-v4-1016-r2` | none | 0 | 0 | 0 | $30.86, 481 tool calls, 65 wakes, 114 alerts; identical repeat of `2022-v4-1016` (same commit f11b60f, same prompt). Same 4h-up read, same levels down to 7745 and 7730; the one difference is the 10:50 bar: run 1 had the session equal lows 7733.4 on its list and took their fourth sweep as a setup, run 2 tracked the GEX -vol strike 7730 instead and read the same bar as close 1 of an excursion below 7745. Eleven attempts reached a sweep bar, every one died at displacement (no 2x body with a gap in three bars) or had its wick taken first. Same wording, same bars: one trade against none |

Three days: baseline -1.77 realised (+18.33 with the open position), 2022-v1
0.00, 7 trades to 0.

2022-v4 with its final wording (commit 9e87c9c or later) on the same three
days: 07-07 no trade (longs only, the market fell all morning); 07-08 one
short, +73.28 unrealised at the 11:45 cutoff, +34.3 gross on replay to its
trailed stop at 12:05; 07-09 one completed checklist (OR low 7480.4 long,
entry alert at the gap edge 7495.7) that never filled because price displaced
at 10:25 and ran 28.8 points without retracing. With the fallback entry (commit 9d90a6b) 07-09 became one long, +72.96
unrealised at 12:00 and about +131 gross replayed to the 16:00 close.

Score, three days: baseline -1.77 realised, +18.33 with its open position;
2022-v4 0.00 realised, +146.24 with its two open positions marked at the
session cutoffs, or about +163 after fees if both are replayed on the
recorded bars to their stop or the 16:00 close. Two trades against seven, both
still open when their sessions ended, so the realised column is empty on the
v4 side and the comparison rests on marks and replays. The 07-07 row for v4
predates the fallback and the re-arm fix; neither would have produced a trade
there, since no long displacement formed. Six model runs, zero completed checklists. The two
07-09 journals independently name the bias rule as what kept the bot out of
the one sweep, displace and run sequence of that morning.

## Calibration scan

`scripts/bot-scan.py` applies the model mechanically to the SP500 1m recording
(weekdays from 2026-04-27 to 2026-10-28, 132 sessions; sweeps 09:30 to 11:30
ET, 5m bars, fixed 2R target, stop beyond the sweep wick, one position at a
time, two losses end the day). It is a calibration aid for the wording in
`bot/`, not a backtest of the bot: it has no GEX and no discretion.

The scan run on 2026-10-27 that chose the v3 rules read the 4h bias from 4h
bars indexed before 09:30 ET, which included the 08:00 to 12:00 bar still
forming at the open, so the bias knew the first two and a half hours of the
session. That is why it showed +23R to +30R. With the bias read from closed 4h
bars only (fixed 2026-10-28), the same rule sets on the same data:

| rule set | setups that filled | net R | win rate |
|---|---|---|---|
| the rules in `models/2022-v3.md` (shift = close beyond the sweep bar, failed break as a sweep, FVG required, market on the first touch of the near edge, fallback market entry at the second close, 4h direction as the bias) | 67 | +5.7 | 43% |
| the same with no bias filter | 127 | +4.2 | 41% |
| the same with the v2 bias rule (daily and 4h must agree, else 4h levels only) | 64 | -5.3 | 39% |
| the same with the daily as the bias | 71 | -9.0 | 35% |
| the same without the FVG requirement | 72 | -7.6 | 32% |
| the same without the MSS | 90 | -0.8 | 39% |
| the same with the shift through a 3-bar swing (the v2 definition) | 55 | +11.0 on the earlier sample | |
| displacement body 1.5x, 2.5x, 3x the average instead of 2x | 85, 55, 39 | +1.0, +5.5, +1.6 | |
| target 1.5R or 3R instead of 2R | 67, 67 | +5.1, -0.7 | |
| gap at least 1 point, or a quarter of the average body | 62, 64 | +7.7, +8.7 | 45% |
| sweep wick at least 1, 2 or 3 points through the level | 57, 39, 34 | +2.2, -7.7, -6.4 | |
| sweeps 09:30 to 10:30 only | 54 | +6.7 | 44% |
| daily, overnight and 4h levels only (no opening range or session extremes) | 59 | +5.9 | 44% |
| displacement must be the bar right after the sweep bar | 41 | +9.8 | 49% |
| the same, single-bar sweeps only | 35 | +12.0 | 54% |

Every variant sits between -9R and +12R over 130 sessions, with 35 to 127
trades, and the better ones are not stable across the two halves of the
sample (the one-bar displacement: -0.3R before 2026-07-01, +10.1R after). A
round trip at taker fees on $93,000 of notional costs about $17, a sixth of a
$100 R, so at 67 trades the fees alone take about 11R. Read mechanically, the
model as written has no edge in this recording; the earlier table claiming one
was the look-ahead. What the scan does support is the ranking that went into
the v3 wording: the sweep-bar shift over the swing shift, the gap requirement,
the market-on-touch entry (no worse than a limit that needs trade-through), and
the fallback (same R per trade with a fifth more trades). Weekend sessions,
which the perp trades, are skipped.

The `--trades` flag lists every trade with day, level, side, entry, stop and
result; use it to pick a recorded day with a setup before spending a sim run
on it.

## Reading a run

- `journal.md` in the run dir: the bot's own record of what it saw, the setups
  it checked, the orders it placed and why, and its end-of-session review.
- `paper-accounts.json`: fills and balance from the paper engine.
- `claude.jsonl`: the full transcript, when the journal is not enough.
- `summary.json`: params, profile, cost, final position.

A session with zero trades and a journal that shows the levels were checked
and no sweep came is a pass. A trade whose journal entry has blanks in the
checklist is the failure mode these files exist to remove.

## Memory

Runs start with an empty auto-memory directory unless `--memory-seed DIR` is
given. Anything the bot writes to memory during a run stays in the run dir and
is discarded. Rules that used to live in memory (GEX usage, explicit asset on
every call, entries on close or retest, take profit at the touching gamma
strike) are in `core.md` and `models/2022.md`.

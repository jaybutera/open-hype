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
| 2026-10-16 (09:00 to 16:00) | 2022-v5 | `2022-v5-1016` | 0 (1 order) | 0 | 0 | 0 | $16.63, 28 wakes, 38 alerts, 7 GEX reads; daily read down, regime negative gamma at every read but one; four displacements in the direction found (09:30, 10:50, 11:05, 14:50) and none traded: the 09:47 sell limit a quarter into the 5m gap (7749.0) was never reached (retrace high 7746.4) and was cancelled under the 12-bar rule; the 11:01 and 11:16 setups were refused on line 7 because the vol put wall, which trailed spot all day (7730, 7735, 7720, 7700, 7650, 7640), sat under the entry; price went 20 to 30 points the trade's way from each |
| 2026-10-22 (09:00 to 13:00) | baseline | `baseline-1022` | 1 short | +127.5 | 4.6 | +122.9 | $5.91; at 10:28, after the 10:24 break of the overnight low, a resting sell limit 5 at 7676.5 in the broken 7675 to 7682 shelf, stop 7686.5 above the 7685 OI put wall, target 7651 at the 7650 vol strike ("not chasing into the wall"); rested two hours, filled 12:20, target hit 12:4x |
| 2026-10-22 (09:00 to 13:00) | 2022-v6 | `2022-v6-1022` | 1 short | -100.0 | 6.0 | -106.0 | $9.16, 19 wakes, 9 GEX reads; side short set at 10:35 by the two-read rule (09:55 was 3 points under zero gamma, no regime), after the 7699.3 to 7646 leg was done; sold the leg's last displacement at the 1m gap edge 7656.0 (filled 10:55), stop 7671.3 at the leg origin, target 7630.1 (1.69R, daily level); the 7650 vol strike 6 points below had held every read with the biggest builds and price pinned on it; the retrace to the put wall took the stop at 12:00, then price fell back to 7645 |
| 2026-10-20 (09:00 to 13:00) | baseline | `baseline-1020` | 1 short | -80.0 | 6.1 | -86.1 | $5.79; short 6.666 at 7673.5 on the retest of the broken 7668.9 low at 09:40 (below zero gamma 7682.95, net GEX negative), stopped 7685.5 at 09:43 as the 09:45 V reversed off the 7660 OI put wall; then a long bid at 7683 cancelled unfilled, a buy limit 7700 at the call strike placed at 10:02 and never touched (price ran to 7745 by 10:30); the agent ended its session at 10:02 with that order resting |
| 2026-10-20 (09:00 to 13:00) | 2022-v7 | `2022-v7-1020` | 0 | 0 | 0 | 0 | $8.89, 15 wakes, 25 alerts, 6 GEX reads; the 09:35 read was missed (first wake 09:46, the 5m close alerts used as timers only fire when a bar closes beyond their price), side long set at 10:19 after the 7666.6 to 7720 grind; from then every long sat under the 7735 call wall, and the one sweep that formed (11:14, overnight high and zero gamma to 7702.8) was refused on line 7 with the prior day high 0.93R away; price never reached 7727.5 again by 13:00. A correct no-trade on the day the baseline lost -86.1 |
| 2026-10-22 (09:00 to 13:00) | 2022-v7 | `2022-v7-1022` | 0 (1 order) | 0 | 0 | 0 | $10.51, 18 wakes, 22 alerts, 8 GEX reads; side short set at 10:16 (reads 09:55 and 10:15); sell limit 7691.7 at the first 1m gap of the 10:05 leg (stop 7701.6 above the 7700 put wall, target 7668.9 at 2.30R) placed 10:16 with price already 16 points below it, cancelled 10:25 when the target was touched unfilled; the 10:20 leg (5m gap edge 7669.3) and the 11:25 rejection off the put wall (entry 7662.8) were both refused with the 7650 vol wall at 1.35R and 1.39R, and price pinned on 7650 for two hours. The baseline's winning order on this day rested at 7676.5, above the leg's gap at the broken shelf, with the stop over the 7685 put wall and the wall 2.55R away |
| 2026-10-15 (09:00 to 13:00) | 2022-v7 | `2022-v7-1015` | 0 | 0 | 0 | 0 | $8.88, 8 GEX reads; side short at 09:55, flipped long at 10:30 by two positive reads (the day's low was 09:55, then +75 points); three setups refused on line 7: the 09:50 break short at 7675.4 with the 7670 put wall 0.26R away (it would have filled at 09:58 and been stopped at 10:05: 1R saved), the 10:00 sweep long at 7692.2 with the 7720 vol wall at 1.13R (never filled anyway), and the 10:40 break long at 7714.8 with the 7720 vol wall 5 points above (would have filled and made about 1R by 11:15: the wall gave way by drift). Every refusal was by the book; the day's walls sat 5 points from every entry |
| 2026-10-15 (09:00 to 13:00) | baseline | `baseline-1015` | 1 long | -76.0 | 9.2 | -85.2 | $9.41; long 10 at 7690.5 in the 09:39 1m gap after the sweep of the overnight low and a displacement up through zero gamma 7688.4, stop 7682.9 under the 09:38 low, target 7707.4; stopped at 09:50 on the bar that broke 7679.0 (the low of the day came five minutes later at 7668.9, then +75 points); the agent finished its session after the loss |
| 2026-10-26 (09:00 to 13:00) | 2022-v7 | `2022-v7-1026` | 0 (1 order) | 0 | 0 | 0 | $8.62, 16 wakes, 10 GEX reads; side long at 10:00 (positive gamma, with the daily disagreeing); the 10:10 break of the prior day high 7659.5 and the 7660 OI call wall gave a buy limit 7661.1 at the first 1m gap, stop 7648.5, target 7688 under the 7690 OI call wall (2.13R), placed 10:21; the retrace bottomed at 7664.5 at 10:30, 3.4 points above the limit, and the target was touched at 10:48 unfilled; the 5m gap's near edge 7668.5 would have filled at 10:30 and reached the target. Correct side, correct setup, wrong edge |
| 2026-10-26 (09:00 to 13:00) | baseline | `baseline-1026` | 1 short, 1 long | -134.8 | 20.2 | -155.0 | $13.43; short 11 at 7656.5 (09:46) on the retrace after the 09:39 sweep of the 7660 OI call wall, stop 7662.7, stopped 09:55; market long 11 at 7670.95 (10:26) on the pullback after the 10:10 break of the call wall, stop 7665.0 under the 1m gap, stopped 10:34 at 7664.95 (the pullback low was 7664.5, then +23 points to the 7688 target area by 10:48); done by the two-loss rule at 10:34 |
| 2026-10-29 (09:00 to 13:00) | 2022-v7 | `2022-v7-1029` | 1 long | +28.2 | 6.6 | +21.6 | $10.79; first fill of a v7 run. No regime at 09:35 and 09:55 (price within a few points of zero gamma), so the 09:30 break of the overnight low was not sold (price pinned on the 7700 wall and reversed); side long at 10:20; buy limit 7710.0 at the 1m gap of the 09:58 sweep off the 7700 put wall, stop 7696.0, target 7734.0 (equal highs, 1.71R, first level in the way with the daily disagreeing); filled 10:47 on the second visit to the gap, stop trailed to 7714.0 at +1.4R behind the 11:10 to 11:20 swing and taken by the 11:51 1m close at 7713.5; session high 7731.5, 2.5 points short of the target. The untrailed stop would have ended the window open at +0.43R |
| 2026-10-26 (09:00 to 11:30) | 2022-v8 | `2022-v8-1026` | 0 | 0 | 0 | 0 | $8.62; the 5m-edge proof run read the morning differently from `2022-v7-1026`: it took the 10:10 bar as the displacement off a zero gamma sweep whose target 7671 printed before the bar after it closed (voided), then checked the 10:15 break of 7671 (5m gap 7670.0 to 7677.9, stop 7658.5 beyond the 7660 OI call wall, 7700 vol wall at 1.14R) and the 10:35 sweep of 7671 (1.22R) and refused both on line 7; the first would have filled at 10:30 and reached 7700 at 11:01. Run-to-run variance is again one full setup; the wall-bounded R arithmetic, not the gap edge, is what keeps v7 and v8 out of positive-gamma mornings |
| 2026-10-21 (09:00 to 13:00) | 2022-v7 | `2022-v7-1021` | 1 short | -100.0 | 8.1 | -108.1 | $16.29, 27 wakes, 16 GEX reads (too many: every timer wake re-read); side short at 10:30 on reads of -22.9k and -7.2k net vol (decaying toward zero, with the biggest builds already on the call side at 7740 and 7750); sell limit 7722.6 at the gap of the 10:05 break of the overnight low, filled 10:31, stop 7734.0 above the leg origin, target the 7700 put wall (1.98R); stopped 10:49; one minute after the fill the read was +8.6k with spot on zero gamma, and the side flipped long at 11:20 as the day ran to 7763. The three long setups after that were refused on line 7 (the first level in the way under 1.5R against the daily) or line 3 |
| 2026-10-29 (09:00 to 13:00) | baseline | `baseline-1029` | 3 longs | -81.9 | 8.3 | -90.2 | $9.91; three market longs of 3 in the first 40 minutes (7710.95 at 09:31 on the failed sweep of the overnight low, 7715.6 at 09:45, 7715.05 at 10:06), stops 7701.5, 7703.5 and 7709.5, all three stopped by 10:10; stood down after the third loss. The day then went to 7731.5 by 11:30 |
| 2026-10-21 (09:00 to 13:00) | baseline | `baseline-1021` | 1 short | -46.0 | 3.7 | -49.7 | $5.19; the same trade as `2022-v7-1021` at a smaller size: sell limit 4 at 7721.5 in the 7714 to 7722.6 breakdown zone, stop 7733, target 7700.5, filled 10:31, stopped 10:49 |
| 2026-10-23 (09:00 to 13:00) | 2022-v7 | `2022-v7-1023` | 0 | 0 | 0 | 0 | $7.66, 24 wakes, 7 GEX reads; negative at 09:35, no regime at 09:55 (1.4 points over zero gamma), side long only at 11:15 after the 7608.1 low and the +47-point run; price then pinned on the 7650 OI put wall for forty minutes with no displacement. Flat on a day the daily rule and the early reads both pointed the wrong way |

Fresh GEX days, both profiles, 09:00 to 13:00 ET: 10-15 baseline -85.2, v7 0;
10-20 baseline -86.1, v7 0; 10-21 baseline -49.7, v7 -108.1; 10-22 baseline
+122.9, v6 -106.0, v7 0; 10-26 baseline -155.0, v7 0; 10-29 baseline -90.2,
v7 +21.6. Six days: baseline -343.3 for $46.6 of sim credit, 2022-v7 -86.5
for $64.3. v7 placed six orders, filled two (one win, one loss), and refused
nine completed checklists on line 7; of the refusals that were fillable, two
would have won about 1R (10-15 10:40, 10-26 10:15 on the v8 run) and one
would have lost 1R (10-15 09:50). The `2022-v7-1019` run
was still running when the session stopped for credits on 2026-10-30; its
row is not yet here (read `/tmp/hl-sim/<run>/journal.md` on box, see
below). `baseline-1019` and `baseline-1023` were killed at the open and have
no result.

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

### The October GEX days under both scans

Run 2026-10-30, the ten weekdays with a GEX archive (2026-10-15 to 10-28),
sweeps or breaks 09:30 to 11:30 ET, fixed 2R, stop beyond the structural
extreme, one position at a time:

| scan | rules | trades on the GEX days | net R | over all 132 sessions |
|---|---|---|---|---|
| `bot-scan.py` (sweep form) | v3 rules, 4h bias | 4 | -2.4 | +5.7 |
| | daily bias | 6 | -3.0 | -9.0 |
| | no bias | 8 | -3.4 | -1.5 |
| | daily bias, body 1.5x, gap a quarter of the average body | 5 | -2.0 | -10.7 |
| `bot-scan-cont.py` (break form) | daily bias, stop beyond the gap | 6 | -3.0 | -16.5 |
| | daily bias, stop beyond the break bar | 6 | -3.8 | -1.4 |
| | daily and 4h must agree | 2 | +1.0 | 0.0 |
| | daily bias, to 15:30 | 9 | 0.0 | -21.1 |

The one scan trade that wins on 2026-10-16 is the PDH 7753.7 sweep at 09:30
(short at 7744.8, stop 7760.2, 2R at 11:15), which every bias except the 4h
allows and which the baseline traded in its own way. Read mechanically, neither
form has an edge in October; the baseline's +36.37 on 10-16 came from the
regime read, 1m gap entries with 6 to 8 point stops, and skipping the
sweeps against the regime, none of which the scans see. `2022-v5` writes
those down instead of thresholds.

### The GEX regime on the October days

From the 0DTE archive (`SPX`, `gex_zero`), read at 09:55, 10:30 and 11:30 ET:
spot minus zero gamma in points, net vol GEX in thousands, then the cash
session open to close. The daily-direction rule in `method/top-down-v4.md`
said down on every one of these days.

| day | 09:55 | 10:30 | 11:30 | cash open to close | side of zero gamma at 10:30 and the move after |
|---|---|---|---|---|---|
| 10-15 | -22, -21k | +6, +31k | +30, +176k | 7686 to 7743 | above; +43 |
| 10-16 | -5, -14k | -10, -55k | -27, -215k | 7755 to 7651 | below; -83 |
| 10-19 | -7, -8k | +12, +41k | +24, +191k | 7695 to 7688 | above; +16 to the 11:37 high, then -38 |
| 10-20 | +7, +14k | +50, +141k | +7, +89k | 7682 to 7716 | above; the high was 10:30, -26 |
| 10-21 | +1, +11k | -7, -15k | +18, +225k | 7736 to 7757 | below; +38 |
| 10-22 | -8, -13k | -34, -95k | -24, -116k | 7686 to 7665 | below; pinned on the 7650 vol strike, -23 to the 15:02 low |
| 10-23 | +1, -3k | -7, -28k | +26, +105k | 7620 to 7623 | below; +36 to the 11:34 high |
| 10-26 | +14, +27k | +15, +73k | +27, +246k | 7646 to 7674 | above; +28 to the 11:01 high, then back |
| 10-27 | -11, -17k | -4, +1k | +25, +337k | 7695 to 7718 | at zero gamma; +44 |
| 10-28 | -5, -1k | +2, +10k | +4, +21k | 7737 to 7762 | above; +29 |
| 10-29 | -2, -6k | +7, +28k | +12, +116k | 7712 to 7721 | above; +13 to the 11:34 high, then -42 |

Net vol GEX in the first hour is within 30k of zero on every day and its
sign at 09:55 matched the session on five of eleven. By 11:30 it is large
and signed, and it describes the move already made more than the one to
come: on 10-19, 10-23 and 10-26 a positive reading above zero gamma was
followed by the afternoon giving the morning back, which is what positive
gamma is supposed to do. The two clean negative-gamma days (10-16, 10-22)
were the two trend days down, and on both the first leg ended on the vol
strike that carried the biggest builds (7700 then 7650 on 10-16, 7650 all
day on 10-22), and the sells that paid were sold on the retrace toward zero
gamma and the OI put wall with that strike as the target. Days where price
sat within about 7 points of zero gamma at 10:30 (10-21, 10-23, 10-27,
10-28) went either way.

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

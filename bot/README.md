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
| `profiles/*.json` | which files make up one bot; `2022-v1` is the first, `2022-v2` adds structure alerts and intraday levels after a run that slept through 2026-07-08; `2022-v3` is v2 with the shift swing taken from inside the leg; `2022-v4` is `models/2022-v3.md` and `method/top-down-v3.md`, the rules recalibrated by the scan below | per experiment |
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
| 2026-07-08 | 2022-v4 | `2022-v4-0708` | 0 | 0 | 0 | 0 | $5.00; 4h down, short only; the 09:45 sweep of the session high got no displacement, then the bot kept only that attempt's alert and missed the 10:00 failed break of ORH 7463.0 (10:10 body 9.9 closed below 7459.3, gap 7458.8 to 7461.1), which the scan sells at 7458.8 for 2R by 10:45 |
| 2026-07-09 | 2022-v4 (target line still v2) | `2022-v4-0709` | 0 | 0 | 0 | 0 | $10.62; 4h read as up, long only; ORL 7480.4 sweep at 10:20 displaced with a gap and was declined on the target line (PDH 7509.2 at 0.8R); the 11:15 sweep of 7516.2 got a 7.1 body against a 10.4 threshold |

Three days: baseline -1.77 realised (+18.33 with the open position), 2022-v1
0.00, 7 trades to 0. Six model runs, zero completed checklists. The two
07-09 journals independently name the bias rule as what kept the bot out of
the one sweep, displace and run sequence of that morning.

## Calibration scan

Six model runs with zero trades were not three quiet days. `scripts/bot-scan.py`
applies the model mechanically to 95 SP500 days (2026-04-27 to 2026-09-09,
sweeps 09:30 to 11:30 ET, 5m bars, fixed 2R target, stop beyond the sweep
wick, one position at a time). Net R over the sample, from the scan on
2026-10-27:

| rule set | setups that filled | net R | win rate |
|---|---|---|---|
| v2 model as written (shift through a 3-bar swing, limit at the far half of the zone, bias "none" when daily and 4h disagree) | 34 | +1.2 | 38% |
| shift = displacement closes beyond the sweep bar's extreme | 42 | +23.7 | 55% |
| plus the limit at the near edge of the FVG | 49 | +23.5 | 55% |
| plus a failed break (up to three closes beyond the level, then a close back) counted as a sweep | 64 | +24.1 | 52% |
| the same with no bias filter | 86 | +3.7 | 37% |
| the same with the v2 bias rule (daily and 4h must agree, else 4h levels only) | 42 | +10.3 | 48% |
| the same without the FVG requirement | 57 | +13.0 | 44% |
| the same, but no trade unless the nearest level in the trade's direction is at least 2R away, and that level as the target (the v2 line 8) | 8 | +1.0 | 38% |
| the same with a daily or 4h level between 2R and 3R replacing the 2R target | 63 | +24.7 | 51% |

Both halves of the sample (before and after 2026-07-01) are positive for the
chosen set. The first `2022-v4` run (2026-07-09, before the target line was
changed) declined two long setups on the v2 target line because an opening
range level sat 4 to 13 points above the entry; both ran past that level. The swing-based shift definition was the blocker: a momentum leg
into a level leaves no swing near the level, so the shift needed a 20 to 30
point drop and the retrace never offered 2R. The scan found one qualifying
setup on each of 2026-07-07 (a loss), 2026-07-08 and 2026-07-09 (both to 2R).
These are the rules in `models/2022-v3.md` and profile `2022-v4`.

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

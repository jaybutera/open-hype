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
| `profiles/*.json` | which files make up one bot; `2022-v1` is the first, `2022-v2` adds structure alerts and intraday levels after a run that slept through 2026-07-08; `2022-v3` is v2 with the shift swing taken from inside the leg | per experiment |

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

Three days: baseline -1.77 realised (+18.33 with the open position), 2022-v1
0.00, 7 trades to 0. Six model runs, zero completed checklists. The two
07-09 journals independently name the bias rule as what kept the bot out of
the one sweep, displace and run sequence of that morning.

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

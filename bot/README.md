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
| `profiles/*.json` | which files make up one bot; `2022-v1` is the first, `2022-v2` adds structure alerts and intraday levels after a run that slept through 2026-07-08 | per experiment |

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
memory dir as the seed and no model. Two runs on the box, both xyz:SP500 5m:

| run | recording | trades | gross | fees | net |
|---|---|---|---|---|---|
| `/tmp/hl-sim/fable-run1` | 2026-07-07 09:05 to 10:40 ET | 2 shorts | +25.89 | 35.98 | -10.10 |
| `/tmp/hl-sim/fable-run2` | 2026-07-08 09:05 to 11:10 ET | 1 long, 1 short | +64.40 | 71.47 | -7.07 |

Profiles are measured against these days first. To rerun the baseline itself,
use `--profile none` with `--memory-seed` pointing at a copy of the memory dir.

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

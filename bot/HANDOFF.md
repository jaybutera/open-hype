# Handoff: making the 2022 model trade (branch bot-v4)

Written 2026-10-27 so the work can continue after a context reset. Everything
below is in this branch; `git log master..bot-v4` lists the commits.

## Goal

The user's ask: the baseline (profile `none`, one-line prompt plus memory seed)
trades and roughly breaks even; profiles 2022-v1 to v3 never placed an order
in six runs. Improve the model profile's performance in the sim, in the ICT
framework, spending sim credits sparingly ($5 to $11 a run).

## What was found

- `scripts/bot-scan.py` applies the model mechanically to 95 recorded days
  (`~/src/ict-scanner/data/xyz:SP500_1m.parquet`, same data the sim replays).
  The v2 wording fills 34 setups in 95 days, +1.2R. Two rules blocked: the
  MSS through a 3-bar swing, and the target at the nearest level >= 2R.
- Rules in `models/2022-v3.md` (profile `2022-v4`): shift = close beyond the
  sweep bar's extreme; failed break (<= 3 closes beyond, one back) is a sweep;
  entry at market on first touch of the FVG's near edge; target 2R or a
  daily/4h level between 2R and 3R; 4h direction only. Scan: 66 trades, +28.1R,
  53% wins, both halves of the sample positive.
- Sim runs so far with v4 (all `/tmp/hl-sim/` on box): `2022-v4-0709` 0
  trades (old target line), `2022-v4-0708-a` 0 trades (slept through a failed
  break), `2022-v4-0708-b` 1 order at 7450.0 touched and unfilled (limit
  entry; now replaced by market on touch). Journals in each run dir.

## How to run

```
ssh box
cd ~/src/hl-frontend-bot-v4 && git fetch -q origin bot-v4 && git checkout -q --detach origin/bot-v4
export PATH="$HOME/.local/bin:$PATH"
node scripts/sim.mjs --asset xyz:SP500 --interval 5m \
  --start "2026-07-08 09:00 ET" --end "2026-07-08 12:00 ET" \
  --profile 2022-v4 --ref origin/bot-v4 \
  --prompt "Trade SP500 on the paper account this morning." \
  --out /tmp/hl-sim/2022-v4-0708-c > /tmp/hl-sim/2022-v4-0708-c.log 2>&1
```

`~/src/hl-frontend-bot-v4` on box is a worktree of `~/src/hl-frontend` with
`node_modules` and `.env` symlinked. `--ref origin/bot-v4` is what the agent
checks out; the profile is read from the worktree. Runs are sequential (port
3001). `scripts/sim.mjs` ends the run at `--end`; a position open then is
reported as unrealised in `summary.json.end`.

Read a run: `journal.md` (what the bot saw, each checklist), `summary.json`
(`cost`, `end.position`), `paper-accounts.json` (fills). Scoreboard in
`bot/README.md`; add a row per run.

Scan a wording change before paying for a run:
`python3 scripts/bot-scan.py ~/src/ict-scanner/data/xyz:SP500_1m.parquet '[{}, {"tick":0.5}]'`
(defaults are the v4 rules; keys and meanings are in `run()`).

## What to do next

1. The three-day batch was stopped after its first run (07-07, $27.34, no
   trade, woke every minute). Run one short session at a time: 07-08 from
   09:40 to 11:45 ET covers the ORH setup the scan trades at 10:00 to 10:45.
   Widen to full mornings and other days only after one run has filled.
2. If the bot still fails to fill, read the journal for the mechanical reason
   (missed alert, misread bar, rule conflict) and fix the wording, not the
   model. Every miss so far was execution, not the setup.
3. If it trades and loses, check the losses against the scan's trades for the
   same day (`--trades` flag prints them) before changing a rule.
4. Days the scan trades (useful for tests): 07-07 short ONL 10:05 (loss),
   07-08 short ORH 10:00 (2R), 07-09 long PDH-as-support 09:30 (2R). The scan's
   PDH is the prior RTH high; the bot's level list also includes it.
5. When the profile beats the baseline on the three days, merge bot-v4 to
   master and run `scripts/deploy-box.sh`. Until then leave master untouched.

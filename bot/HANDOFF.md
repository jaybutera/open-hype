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

## Latest result (2026-10-27, run `2022-v4-0708-c`)

First fill of any model profile. 07-08, 09:40 to 11:45 ET, $12.26: short
4.728 at 7446.35 after the ORH failed break (sweep 10:25, displacement 10:35,
gap 7450.0 to 7451.1), stop 7467.5, target 7404.0 (2R), stop trailed to
7439.1 by 11:31. Open at the cutoff with +73.28 unrealised. Replaying the rest
of the day from the parquet: the trailed stop fills at 12:05 for +0.34R; the
untrailed stop would have lost 1R at 12:52; the target was never reached.
Two things to know: the sim fills a market order placed on a cross alert at
the close of the 1m bar that fired it (3.65 points through the edge here,
which cost 0.5R of target distance), and 5m-swing trailing is what turned
this one from a loss into a small win, so do not loosen the trailing text in
`core.md` without scanning it.

Run `2022-v4-0709-b` (07-09, 09:00 to 12:00, $10.09): checklist completed
for the OR low long, entry alert at the gap edge 7495.7, never touched; the
move ran 28.8 points from the edge without a retrace. No trade. Three-day
score against the baseline is in the README scoreboard; the two are not
separated by these days.

The open question is the entry. The gap-edge retrace is what the scan rates
best over 95 days (+28R), but it misses the strongest moves (07-09) and the
sim's market fill on a cross alert lands at the firing 1m bar's close
(07-08, 3.65 points through the edge). Scanned: a fallback market entry at the
second 5m close after the zone is known, when no touch came and the close is
on the trade's side, gives 79 trades and +30.2R (fallback after 3 or 6 bars:
+27.6R, +28.3R; both halves positive). It is line 6 of the model (commit 9d90a6b) and run `2022-v4-0709-c`
executed it as the replay predicted: long 3.944 at 7504.85 on the 10:40 close,
+72.96 unrealised at 12:00. Three-day score is in the README. Still open: sessions to 16:00 ET so
fills resolve, and the sim's market fill at the firing 1m bar's close.

## What to do next

1. One run at a time. Both v4 trades were open at their cutoffs, so the next
   runs should end at 16:00 ET (cost grows with wakes, not clock time) to get
   realised numbers. Then a day outside July the bot has never seen, picked
   from `scripts/bot-scan.py --trades`, and a rerun of 07-07 with the final
   wording to complete the three-day set.
2. Consider ending sim sessions at 16:00 instead of 12:00 once a run fills,
   so open positions resolve; the scan's edge assumes positions run to stop or
   target. Cost grows with wakes, not clock time, so a quiet afternoon is cheap.
3. If the bot still fails to fill, read the journal for the mechanical reason
   (missed alert, misread bar, rule conflict) and fix the wording, not the
   model. Every miss so far was execution, not the setup.
4. If it trades and loses, check the losses against the scan's trades for the
   same day (`--trades` flag prints them) before changing a rule.
5. Days the scan trades (useful for tests): 07-07 short ONL 10:05 (loss),
   07-08 short ORH 10:00 (2R), 07-09 long PDH-as-support 09:30 (2R). The scan's
   PDH is the prior RTH high; the bot's level list also includes it.
6. When the profile beats the baseline on the three days, merge bot-v4 to
   master and run `scripts/deploy-box.sh`. Until then leave master untouched.

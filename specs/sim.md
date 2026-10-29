# Sim sessions

A normal Claude Code trading session run against recorded candles instead of
the live market. The agent gets the same `hl-chart` tools and runs the same
`wait` commands; nothing in its tools says it is in a sim. Replay time stands
still while the agent works and jumps forward while it waits.

## Running one

```
node scripts/sim.mjs --asset xyz:SP500 --interval 5m \
  --start "2026-07-07 09:00 ET" --end "2026-07-07 16:00 ET" \
  --prompt "Trade the SP500 session on the paper account." \
  [--profile 2022-v1] [--model claude-fable-5-1] [--port 3001] [--out DIR] \
  [--memory-seed DIR] [--no-faketime] [--config params.json]
```

`--profile` names `bot/profiles/<name>.json`; its files are concatenated and
appended to the system prompt. The `--prompt` line carries only the asset, the
account and the window; the method is in `bot/` (see `bot/README.md`). Auto
memory starts empty unless `--memory-seed` is given.

`--config` reads the same keys from a JSON file. Output goes to `--out`
(default `/tmp/hl-sim/<date>-<id>`):

| file | contents |
|---|---|
| `sim.jsonl` | clock events: start, idle, wake, alert-fired, trade, end |
| `instructions.md` | the assembled bot instructions the agent was given |
| `journal.md` | the agent's own record: levels, setup checks, orders, close review |
| `claude.jsonl` | the session transcript (stream-json) |
| `shots/*.png` | the chart at start, at each wake, at the end |
| `paper-accounts.json` | the page's paper account: fills, balance |
| `summary.json` | params, profile and instructions hash, exit code, cost, final position |
| `memory/` | the agent's auto memory for this run |

Box needs a Claude login usable without a terminal: `claude setup-token`, with
the token in `~/.config/hl-sim/token` (the runner exports it as
`CLAUDE_CODE_OAUTH_TOKEN`), or a regular `/login`.

## Processes

```
sim.mjs
 ├─ vite --port 3001 --host 127.0.0.1   SIM=1, SIM_LOG=<out>/sim.jsonl
 ├─ headless Chrome (puppeteer-core)    the page: replay + paper engine
 └─ faketime -f @<start> claude -p ...  TZ=America/New_York
      --settings <out>/settings.json    hooks, autoMemoryDirectory=<out>/memory
      --append-system-prompt <bot/ files of the profile>
      --mcp-config <out>/mcp.json --strict-mcp-config   hl-chart -> :3001
      --disallowedTools CronCreate CronDelete CronList ScheduleWakeup
```

The sim server is a second dev server, so the always-on :3000 instance, its
tab and its alerts are untouched. It binds to localhost: a second browser tab
on it would also answer sim and trade events.

## Clock (sim-clock.ts)

- busy: the cursor stands still.
- idle: the Stop hook posted `/api/sim/idle`. The server sends the page
  `hl-ai:sim-advance` one minute at a time; the page replies with that
  minute's 1m bars, which go through `AlertEngine.ingestBar`.
- A long-poll that resolves (alert fired, proposal decided) wakes the agent:
  idle -> busy. One that resolves while the agent is still busy means another
  wake follows its turn, so the next Stop is absorbed; if no hook activity
  follows within 30s the clock goes idle anyway.
- `PreToolUse` and `UserPromptSubmit` hooks post `/api/sim/busy`; activity
  while idle stops the clock.
- `end` reached or data exhausted: ended. The runner gives the agent 2
  minutes, then stops it.

The clock does not run while the agent thinks. Orders fill at the price of
the minute the agent acted in.

## What changed where

- `alert-engine.ts`: `feed: 'manual'` (no websocket, `now` from the sim)
  and `ingestBar()`. Cross alerts walk open, nearer extreme, far extreme,
  close; close alerts get the bar as an update of its interval bucket.
- `vite-ai-plugin.ts`: `/api/sim/*` routes, the advance loop, wakes from
  the alert and trade long-polls, `replay: false` in the view, live
  proposals refused.
- `useReplayStore.simAdvance(n)`: advance and return each minute's bars.
- `link.ts`: `hl-ai:sim-start` / `hl-ai:sim-advance` handlers; snapshot
  `takenAt` from `appNow()`.
- `hl-chart-mcp.mjs`: `get_candles` reads `/api/replay/candles` up to the
  cursor when `/api/sim/clock` says a sim is active.
- `vite-gex-plugin.ts`: under SIM=1 GEX comes from the end-of-day archive
  (`gex-archive.ts`, `~/data/gexbot-eod` from `scripts/gex-eod-fetch.mjs`):
  the record at the replay cursor, shifted like the candles; a day without an
  archive answers 503 as GEXBot does for history.
- `scripts/sim.mjs`: the runner. `CLAUDE_BIN` swaps the agent binary.

## Known gaps

- `date` in Bash starts at the sim start and runs at wall-clock speed, so the
  time of day drifts from the cursor once the clock fast-forwards.
- Alerts are checked at 1m granularity: one that fires mid-minute reports
  the minute's end as its time.
- Only coins on the chart pane or with paper exposure are replayed; an
  alert on another asset will not fire.
- The model may know 2026 SP500 prices from training.

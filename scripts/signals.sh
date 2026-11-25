#!/usr/bin/env bash
# Control the v3 strategy runner that feeds the app's "Strategy signals" cards.
# It runs on box as the systemd user unit hl-signals (deploy/hl-signals.service),
# next to the dev server, so it keeps reporting with this laptop closed.
#
#   scripts/signals.sh start     copy the presets to box, install the unit, start it (also after a preset change)
#   scripts/signals.sh stop
#   scripts/signals.sh restart
#   scripts/signals.sh status    unit state, the runner's last lines, what the app lists
#   scripts/signals.sh logs      follow the runner's log
#   scripts/signals.sh local     run it on this machine in the foreground against HL_FRONTEND_URL
#
# Environment: SIGNALS_HOST (default casper@100.117.74.55), SIGNALS_KEY (default ~/.ssh/host243),
# ICT_STRATEGIES_DIR (default ~/src/ict-strategies).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${SIGNALS_HOST:-casper@100.117.74.55}"
KEY="${SIGNALS_KEY:-$HOME/.ssh/host243}"
STRATEGIES="${ICT_STRATEGIES_DIR:-$HOME/src/ict-strategies}"
SSH=(ssh -o ConnectTimeout=10)
[[ -f "$KEY" ]] && SSH+=(-i "$KEY" -o IdentitiesOnly=yes)
on_box() { "${SSH[@]}" "$HOST" "$@"; }

status() {
  on_box 'systemctl --user is-active hl-signals || true; journalctl --user -u hl-signals --no-pager -n 6 -o cat; echo; curl -s -m 5 localhost:3000/api/signals' |
    python3 -c '
import json, sys, time
*head, last = sys.stdin.read().rstrip().split("\n")
print("\n".join(head))
try:
    d = json.loads(last)
except ValueError:
    sys.exit("dev server did not answer: " + last[:200])
for s in d.get("sources", []):
    age = time.time() - s["lastPushAt"] / 1000
    print("%s: last report %.0fs ago, %ss after the bar close; %s" % (s["source"], age, s.get("lagSec", "?"), s.get("watching", "")))
for s in d["signals"]:
    print("  %-5s %-11s %-3s entry %s stop %s target %s" % (s["side"], s["asset"], s.get("tf", ""), s["entry"], s["stop"], s["target"]))
if not d["signals"]:
    print("  no live setups")'
}

case "${1:-status}" in
  start)
    rsync -a --delete --exclude target -e "${SSH[*]}" "$STRATEGIES/" "$HOST:src/ict-strategies/"
    on_box 'test -x ~/src/backtest-engine-v3/target/release/backtest' || {
      echo "box has no v3 engine: git -C ~/src/backtest-engine worktree add ~/src/backtest-engine-v3 origin/v3 && cargo build --release there" >&2
      exit 1
    }
    on_box 'cd ~/src/hl-frontend && git pull -q --ff-only; cp deploy/hl-signals.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable -q hl-signals && systemctl --user restart hl-signals'
    echo "started; first report follows the next minute close"
    ;;
  stop)    on_box 'systemctl --user stop hl-signals'; echo stopped ;;
  restart) on_box 'systemctl --user restart hl-signals'; echo restarted ;;
  status)  status ;;
  logs)    on_box 'journalctl --user -u hl-signals -f -n 30 -o cat' ;;
  local)   shift; exec uv run --quiet scripts/strategy-signals.py "$@" ;;
  *)       sed -n '2,16p' "$0" >&2; exit 2 ;;
esac

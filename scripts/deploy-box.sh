#!/usr/bin/env bash
# Update the always-on dev server on box to origin/master and restart it.
# The unit's ExecStartPre does the pull and npm install; this just restarts it and shows the result.
set -euo pipefail
HOST="${1:-box}"
ssh "$HOST" 'systemctl --user restart hl-frontend && sleep 4 && systemctl --user is-active hl-frontend && cd ~/src/hl-frontend && git log --oneline -1'
curl -s -m 10 -o /dev/null -w "box dev server: HTTP %{http_code}\n" "http://100.117.74.55:3000/api/ai/alerts"

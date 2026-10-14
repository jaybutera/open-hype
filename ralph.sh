#!/bin/bash
set -e

SPEC="${1:-specs/options-paper.md}"
LOGFILE=".ralph-$(basename "$SPEC" .md).log"

STOP_AFTER_LOOP=0

trap 'if [ "$STOP_AFTER_LOOP" -eq 1 ]; then echo -e "\nForce quit."; exit 130; else STOP_AFTER_LOOP=1; echo -e "\nWill exit after current loop. Press Ctrl+C again to force quit."; fi' INT

while :; do
    echo "=== $(date -Iseconds) ===" >> "$LOGFILE"
    claude -p --verbose --output-format stream-json --dangerously-skip-permissions < "$SPEC" | \
        jq --unbuffered -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text // empty' | \
        tee -a "$LOGFILE" || break

    if [ "$STOP_AFTER_LOOP" -eq 1 ]; then
        echo "Exiting after loop completion."
        exit 0
    fi
done

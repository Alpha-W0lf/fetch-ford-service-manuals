#!/usr/bin/env bash
# Start bulk download detached from the calling shell (survives IDE/terminal close).
#
# Usage:
#   ./scripts/start-bulk-download.sh
#   PARALLEL=2 ./scripts/start-bulk-download.sh
#
# Prefer this over running bulk-download.sh directly from automation/IDE sessions.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs

if pgrep -f 'scripts/bulk-download.sh' >/dev/null 2>&1; then
  echo "bulk-download.sh already running:"
  pgrep -fl 'scripts/bulk-download.sh' | sed 's/^/  /'
  exit 1
fi

LOG="logs/bulk-download-$(date +%Y%m%d-%H%M).log"
PIDFILE="logs/bulk-download.pid"

export PARALLEL="${PARALLEL:-2}"

# Double-detach: survive IDE/agent session teardown (SIGHUP to process group).
# Parent exits immediately; caffeinate + bulk-download run under init-like nohup.
nohup bash -c "
  cd '$ROOT'
  exec caffeinate -dims env PARALLEL='$PARALLEL' '$ROOT/scripts/bulk-download.sh'
" >>"$LOG" 2>&1 </dev/null &
DETACH_PID=$!
disown -h "$DETACH_PID" 2>/dev/null || true
echo "$DETACH_PID" >"$PIDFILE"

echo "Started bulk download (PARALLEL=$PARALLEL)"
echo "  log:    $LOG"
echo "  pid:    $(cat "$PIDFILE") (caffeinate wrapper; orchestrator pid in $LOG or pgrep)"
echo "  health: ./scripts/queue-status.sh --health"

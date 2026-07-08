#!/usr/bin/env bash
# Watchdog: restart bulk if orchestrator is not running.
# Restarts via Terminal.app so the process tree is NOT tied to Cursor/IDE/launchd TCC.
#
# Usage:
#   ./scripts/ensure-bulk-running.sh
#   ./scripts/install-bulk-watchdog.sh
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
LOG="$ROOT/logs/watchdog.log"
COOLDOWN_FILE="$ROOT/logs/watchdog-last-restart.txt"
COOLDOWN_SEC="${WATCHDOG_COOLDOWN_SEC:-600}"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >>"$LOG"
}

if pgrep -f 'scripts/bulk-download.sh' >/dev/null 2>&1; then
  workers=$(pgrep -fc 'yarn start' 2>/dev/null || echo 0)
  log "OK bulk running (yarn workers: $workers)"
  exit 0
fi

now=$(date +%s)
if [[ -f "$COOLDOWN_FILE" ]]; then
  last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  if [[ "$last" =~ ^[0-9]+$ ]] && (( now - last < COOLDOWN_SEC )); then
    log "SKIP restart (cooldown ${COOLDOWN_SEC}s, last $((now - last))s ago)"
    exit 0
  fi
fi

log "RESTART bulk not running — opening Terminal.app"
echo "$now" >"$COOLDOWN_FILE"

osascript <<EOF
tell application "Terminal"
  do script "cd '$ROOT' && ./scripts/pipeline-health.sh --fix-locks && node scripts/reconcile-queue.js && export SKIP_BACKFILL_ON_START=1 PARALLEL=2 && ./scripts/start-bulk-download.sh && sleep 3 && ./scripts/queue-status.sh --health && echo '' && echo 'Bulk running under caffeinate. Minimize this window.'"
end tell
EOF

log "RESTART issued via Terminal.app"

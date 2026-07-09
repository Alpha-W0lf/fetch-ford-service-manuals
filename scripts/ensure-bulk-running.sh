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
STALL_MIN="${WATCHDOG_STALL_WORKERS_MIN:-20}"
QUEUE="${QUEUE:-$ROOT/templates/vehicles.json}"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >>"$LOG"
}

count_downloading() {
  node - "$QUEUE" <<'NODE'
const fs = require("fs");
const q = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const n = (q.vehicles || []).filter((v) => v.status === "downloading").length;
process.stdout.write(String(n));
NODE
}

latest_bulk_log() {
  ls -t "$ROOT"/logs/bulk-download-*.log 2>/dev/null | head -1 || true
}

bulk_log_stale_min() {
  local f="$1"
  [[ -z "$f" || ! -f "$f" ]] && echo 999999 && return
  local now mtime age
  now=$(date +%s)
  if stat -f %m "$f" >/dev/null 2>&1; then
    mtime=$(stat -f %m "$f")
  else
    mtime=$(stat -c %Y "$f")
  fi
  age=$(( (now - mtime) / 60 ))
  echo "$age"
}

issue_restart() {
  local reason="$1"
  local now
  now=$(date +%s)
  if [[ -f "$COOLDOWN_FILE" ]]; then
    local last
    last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
    if [[ "$last" =~ ^[0-9]+$ ]] && (( now - last < COOLDOWN_SEC )); then
      log "SKIP restart ($reason; cooldown ${COOLDOWN_SEC}s, last $((now - last))s ago)"
      exit 0
    fi
  fi
  log "RESTART $reason — opening Terminal.app"
  echo "$now" >"$COOLDOWN_FILE"
  osascript <<EOF
tell application "Terminal"
  do script "cd '$ROOT' && ./scripts/pipeline-health.sh --fix-locks && node scripts/reconcile-queue.js && export SKIP_BACKFILL_ON_START=1 PARALLEL=2 && ./scripts/start-bulk-download.sh && sleep 3 && ./scripts/queue-status.sh --health && echo '' && echo 'Bulk running under caffeinate. Minimize this window.'"
end tell
EOF
  log "RESTART issued via Terminal.app"
}

if pgrep -f 'scripts/bulk-download.sh' >/dev/null 2>&1; then
  workers=$(pgrep -fc 'yarn start' 2>/dev/null || echo 0)
  downloading=$(count_downloading)
  bulk_log=$(latest_bulk_log)
  log_age=$(bulk_log_stale_min "$bulk_log")
  if [[ "$workers" -eq 0 && "$downloading" -gt 0 && "$log_age" -ge "$STALL_MIN" ]]; then
    issue_restart "stall (0 yarn workers, downloading=$downloading, bulk log stale ${log_age}min >= ${STALL_MIN}min)"
    exit 0
  fi
  log "OK bulk running (yarn workers: $workers, downloading: $downloading)"
  exit 0
fi

issue_restart "bulk not running"

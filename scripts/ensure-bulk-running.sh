#!/usr/bin/env bash
# Watchdog: restart bulk if orchestrator is not running.
# Restarts via Terminal.app so the process tree is NOT tied to Cursor/IDE/launchd TCC.
#
# Usage:
#   ./scripts/ensure-bulk-running.sh
#   FORD_REPO_ROOT=/abs/path ./scripts/ensure-bulk-running.sh
#   ./scripts/install-bulk-watchdog.sh
#
# Intentional pause (no auto-restart) — path outside Documents for launchd TCC:
#   touch ~/Library/Logs/ford-bulk-watchdog.pause
# Resume:
#   rm -f ~/Library/Logs/ford-bulk-watchdog.pause
#
# Repo-local alias (optional; same effect when this script runs with Documents access):
#   touch logs/watchdog.pause
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -n "${FORD_REPO_ROOT:-}" ]]; then
  ROOT="$(cd "$FORD_REPO_ROOT" && pwd)"
else
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

# Prefer Library logs for anything launchd may also touch; repo log when writable.
SYS_LOG_DIR="${HOME}/Library/Logs"
mkdir -p "$SYS_LOG_DIR"
SYS_LOG="${SYS_LOG_DIR}/ford-bulk-watchdog.log"
SYS_PAUSE="${SYS_LOG_DIR}/ford-bulk-watchdog.pause"
SYS_COOLDOWN="${SYS_LOG_DIR}/ford-bulk-watchdog-last-restart.txt"

REPO_LOG=""
REPO_PAUSE=""
if [[ -d "$ROOT" ]]; then
  mkdir -p "$ROOT/logs" 2>/dev/null || true
  REPO_LOG="$ROOT/logs/watchdog.log"
  REPO_PAUSE="$ROOT/logs/watchdog.pause"
fi

COOLDOWN_SEC="${WATCHDOG_COOLDOWN_SEC:-600}"
STALL_MIN="${WATCHDOG_STALL_WORKERS_MIN:-20}"
QUEUE="${QUEUE:-$ROOT/templates/vehicles.json}"

log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  echo "$line" >>"$SYS_LOG" 2>/dev/null || true
  if [[ -n "$REPO_LOG" ]]; then
    echo "$line" >>"$REPO_LOG" 2>/dev/null || true
  fi
}

# Hard fail closed if ROOT is wrong — never open Terminal against a bogus path
# (2026-07-12: relative ROOT from ~/bin → /Users/tom → window storm).
if [[ ! -f "$ROOT/scripts/bulk-download.sh" || ! -f "$ROOT/scripts/start-bulk-download.sh" ]]; then
  log "FATAL invalid ROOT=$ROOT (missing bulk scripts); refusing Terminal restart"
  exit 1
fi

if [[ -f "$SYS_PAUSE" || -f "$REPO_PAUSE" ]]; then
  log "SKIP restart (pause file present)"
  exit 0
fi

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
  if [[ -f "$SYS_COOLDOWN" ]]; then
    local last
    last=$(cat "$SYS_COOLDOWN" 2>/dev/null || echo 0)
    if [[ "$last" =~ ^[0-9]+$ ]] && (( now - last < COOLDOWN_SEC )); then
      log "SKIP restart ($reason; cooldown ${COOLDOWN_SEC}s, last $((now - last))s ago)"
      exit 0
    fi
  fi
  log "RESTART $reason — opening Terminal.app (ROOT=$ROOT)"
  echo "$now" >"$SYS_COOLDOWN"
  osascript <<EOF
tell application "Terminal"
  do script "cd '$ROOT' && ./scripts/pipeline-health.sh --fix-locks && node scripts/reconcile-queue.js && export SKIP_BACKFILL_ON_START=1 PARALLEL=2 && ./scripts/start-bulk-download.sh && sleep 3 && ./scripts/queue-status.sh --health && echo '' && echo 'Bulk running under caffeinate. Minimize this window.'"
end tell
EOF
  log "RESTART issued via Terminal.app"
}

if pgrep -f 'scripts/bulk-download.sh' >/dev/null 2>&1; then
  workers=$(pgrep -fc 'yarn start' 2>/dev/null || echo 0)
  # Stall detection needs Documents access; if unreadable, treat as healthy process-alive.
  if [[ -r "$QUEUE" ]]; then
    downloading=$(count_downloading)
    bulk_log=$(latest_bulk_log)
    log_age=$(bulk_log_stale_min "$bulk_log")
    if [[ "$workers" -eq 0 && "$downloading" -gt 0 && "$log_age" -ge "$STALL_MIN" ]]; then
      issue_restart "stall (0 yarn workers, downloading=$downloading, bulk log stale ${log_age}min >= ${STALL_MIN}min)"
      exit 0
    fi
    log "OK bulk running (yarn workers: $workers, downloading: $downloading)"
  else
    log "OK bulk running (yarn workers: $workers; queue unreadable from this context — skip stall check)"
  fi
  exit 0
fi

issue_restart "bulk not running"

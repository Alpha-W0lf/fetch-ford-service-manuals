#!/usr/bin/env bash
# Report pipeline health: locks, processes, queue summary.
# Usage: ./scripts/pipeline-health.sh [--fix-locks]
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FIX=false
[[ "${1:-}" == "--fix-locks" ]] && FIX=true

is_pid_alive() {
  local pid="$1"
  [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

check_lock() {
  local name="$1" dir="$2"
  if [[ "$name" == "bulk-download" ]]; then
    local lock_dir="$ROOT/logs/bulk-download.lock"
    if pgrep -f 'scripts/bulk-download.sh' >/dev/null 2>&1; then
      local pid=""
      read -r pid <"$lock_dir/pid" 2>/dev/null || true
      echo "  bulk-download: held (pid ${pid:-?}, orchestrator running)"
      return 0
    fi
    if [[ -d "$lock_dir" ]]; then
      echo "  bulk-download: STALE (no orchestrator; will auto-clear on next start)"
      if $FIX; then
        rm -rf "$lock_dir"
        rm -f "$ROOT/logs/bulk-download.lock"
        echo "    → removed stale bulk lock"
      fi
      return 1
    fi
    echo "  bulk-download: free"
    return 0
  fi

  if [[ ! -d "$dir" ]]; then
    echo "  $name: free"
    return 0
  fi
  local holder="" pid=""
  [[ -f "$dir/holder" ]] && holder=$(cat "$dir/holder" 2>/dev/null)
  [[ -f "$dir/pid" ]] && pid=$(cat "$dir/pid" 2>/dev/null)
  if [[ "$name" == "bulk-download" ]] && pgrep -f 'scripts/bulk-download.sh' >/dev/null 2>&1; then
    echo "  $name: held (bulk-download.sh running, pid file=${pid:-?})"
    return 0
  fi
  if is_pid_alive "$pid"; then
    echo "  $name: held by ${holder:-?} (pid $pid)"
    return 0
  fi
  echo "  $name: STALE (pid ${pid:-none}, no live holder)"
  if $FIX; then
    rm -rf "$dir"
    echo "    → removed stale $name"
  fi
  return 1
}

echo "=== Pipeline health ==="
echo "Processes:"
if pgrep -fl 'scripts/bulk-download.sh' >/dev/null 2>&1; then
  pgrep -fl 'scripts/bulk-download.sh' | sed 's/^/  bulk: /'
else
  echo "  bulk: not running"
fi
if pgrep -fl 'capture-params.ts' >/dev/null 2>&1; then
  pgrep -fl 'capture-params.ts' | sed 's/^/  params: /'
else
  echo "  params: not running"
fi
workers=$(pgrep -fl 'yarn start' 2>/dev/null | grep -c 'manuals/' || true)
echo "  yarn workers: $workers"

echo "Locks:"
stale=0
check_lock "bulk-download" "" || stale=1
check_lock "cdp-chrome" "$ROOT/logs/cdp-chrome.lock" || stale=1

echo "Queue:"
./scripts/queue-status.sh 2>/dev/null | head -15

if [[ $stale -eq 1 && "$FIX" == "false" ]]; then
  echo ""
  echo "Stale lock(s) detected. Run: ./scripts/pipeline-health.sh --fix-locks"
fi

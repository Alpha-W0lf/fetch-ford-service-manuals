#!/usr/bin/env bash
# Start param capture in macOS Terminal.app (NOT Cursor's integrated terminal).
# Runs alongside bulk; CDP lock coordinates connector vs capture work.
#
# Usage:
#   ./scripts/start-capture-in-terminal.sh
#   ./scripts/start-capture-in-terminal.sh --restart
#   ./scripts/start-capture-in-terminal.sh --limit 10
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESTART=false
CAPTURE_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--restart" ]]; then
    RESTART=true
  else
    CAPTURE_ARGS+=("$arg")
  fi
done
EXTRA_ARGS="${CAPTURE_ARGS[*]:-}"

if pgrep -f 'yarn capture-params' >/dev/null 2>&1; then
  if [[ "$RESTART" == true ]]; then
    echo "Stopping existing capture-params..."
    pkill -f 'scripts/capture-params' 2>/dev/null || true
    pkill -f 'yarn capture-params' 2>/dev/null || true
    pkill -f 'run-capture-params.sh' 2>/dev/null || true
    sleep 2
  else
    echo "capture-params already running:"
    pgrep -fl 'yarn capture-params' | sed 's/^/  /'
    echo "Use --restart to stop and start fresh in Terminal.app"
    exit 0
  fi
fi

if ! curl -sf http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "PTS Chrome CDP not available on :9222"
  echo "Start PTS Chrome first: ./scripts/launch-pts-chrome.sh"
  exit 1
fi

osascript <<EOF
tell application "Terminal"
  activate
  do script "cd '$ROOT' && ./scripts/run-capture-params.sh $EXTRA_ARGS && echo '' && echo 'Param capture session ended. Log: logs/capture-params-*.log'"
end tell
EOF

echo "Opened Terminal.app for param capture."
echo "  health: ./scripts/queue-status.sh --health"

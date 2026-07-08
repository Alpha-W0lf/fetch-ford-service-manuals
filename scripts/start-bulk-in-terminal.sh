#!/usr/bin/env bash
# Start bulk in macOS Terminal.app (NOT Cursor's integrated terminal).
# Use this for manual starts when you want a visible, detached session.
#
# Usage:
#   ./scripts/start-bulk-in-terminal.sh
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if pgrep -f 'scripts/bulk-download.sh' >/dev/null 2>&1; then
  echo "bulk-download.sh already running:"
  pgrep -fl 'scripts/bulk-download.sh' | sed 's/^/  /'
  exit 0
fi

osascript <<EOF
tell application "Terminal"
  activate
  do script "cd '$ROOT' && ./scripts/pipeline-health.sh --fix-locks && node scripts/reconcile-queue.js && export SKIP_BACKFILL_ON_START=1 && ./scripts/start-bulk-download.sh && echo '' && echo 'Bulk started. Health: ./scripts/queue-status.sh --health' && echo 'Minimize this window — do not use Cursor terminal for long runs.'"
end tell
EOF

echo "Opened Terminal.app to start bulk download."

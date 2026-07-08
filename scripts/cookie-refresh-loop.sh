#!/usr/bin/env bash
# Optional standalone cookie refresh (bulk-download.sh also refreshes on a schedule).
# Requires PTS Chrome: ./scripts/launch-pts-chrome.sh
#
# Usage:
#   ./scripts/cookie-refresh-loop.sh
#   COOKIE_REFRESH_SEC=10800 ./scripts/cookie-refresh-loop.sh   # every 3h (default)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
INTERVAL="${COOKIE_REFRESH_SEC:-10800}"
mkdir -p logs
echo "Cookie refresh loop: every ${INTERVAL}s (PTS Chrome CDP :9222)"
while true; do
  node "$ROOT/scripts/export-cookies-from-chrome.js" >>logs/cookie-refresh.log 2>&1 || true
  sleep "$INTERVAL"
done

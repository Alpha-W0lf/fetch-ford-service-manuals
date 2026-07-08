#!/usr/bin/env bash
# Capture params via PTS Chrome CDP (the approach that worked for 100+ vehicles).
# Waits for bulk connector jobs to release the shared CDP lock.
#
# Usage:
#   ./scripts/run-capture-params.sh
#   ./scripts/run-capture-params.sh --limit 10
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG="logs/capture-params-$(date +%Y%m%d-%H%M).log"

if ! curl -sf http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "PTS Chrome CDP not available. Start: ./scripts/launch-pts-chrome.sh"
  exit 1
fi

echo "Waiting for CDP lock (bulk connector jobs release it automatically)..."
node -e "
const { waitUntilFree } = require('./scripts/cdp-chrome-lock');
if (!waitUntilFree(parseInt(process.env.CDP_LOCK_WAIT_MS || '600000', 10))) {
  console.error('Timed out waiting for CDP Chrome lock');
  process.exit(1);
}
console.log('CDP lock free — starting capture-params');
"

exec yarn capture-params --all "$@" 2>&1 | tee "$LOG"

#!/usr/bin/env bash
# Priority-aware bulk downloader with optional parallel workers.
# Polls the queue for new pending vehicles while workers run (no restart needed).
#
# Thin wrapper (Guide 04): lock + trap cleanup → Node orchestrator.
#
# Usage:
#   ./scripts/bulk-download.sh [queue.json]
#   PARALLEL=2 ./scripts/bulk-download.sh
#   caffeinate -dims PARALLEL=2 ./scripts/bulk-download.sh
#
# Env:
#   POLL_SEC       — seconds between queue checks when idle (default: 15)
#   IDLE_EXIT_MIN  — exit after N minutes with no pending work and no workers (default: 0 = never)
#   COOKIE_REFRESH_MIN — refresh cookies from PTS Chrome every N minutes (default: 180 = 3h; 0=disable)
#   HTTP_MAX_RETRIES — per-request axios/playwright retries (default: 5)
#   HTTP_RETRY_BUDGET_MS — max wall time retrying one request (default: 120000 = 2 min)
#   HTTP_REQUEST_TIMEOUT_MS — axios socket timeout per attempt (default: 90000)
#   CIRCUIT_BREAKER_THRESHOLD — consecutive auth failures before backoff (default: 2)
#   CIRCUIT_BREAKER_BACKOFF_SEC — pause new jobs after auth failures (default: 600)
#   STALE_GAP_ATTEMPTS — deprioritize incomplete vehicles when every gap has this many failed attempts (default: 10)
#   RECONCILE_EVERY_MIN — re-run reconcile-queue when idle (default: 60; 0=startup only)
#   PDF_AUDIT_EVERY_MIN — spot-check PDF integrity when idle (default: 120; 0=disable)
#   PDF_AUDIT_SAMPLE — random PDFs per spot-check (default: 50)
#
# Queue statuses:
#   pending       — ready to download (params.json exists)
#   downloading   — in progress (reset to pending on interrupt via reconcile)
#   needs_params  — skipped until params captured
#   complete      — verified full capture (no gaps)
#   incomplete    — partial capture; capture-gaps.json lists missing pages (retry priority)
#   failed        — hard failure (auth, crash, too few PDFs)
#   skip          — excluded
set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUEUE="${1:-templates/vehicles.json}"
LOG_DIR="$ROOT/logs"
export POLL_SEC="${POLL_SEC:-15}"
export IDLE_EXIT_MIN="${IDLE_EXIT_MIN:-0}"
export COOKIE_REFRESH_MIN="${COOKIE_REFRESH_MIN:-180}"
export CIRCUIT_BREAKER_THRESHOLD="${CIRCUIT_BREAKER_THRESHOLD:-2}"
export CIRCUIT_BREAKER_BACKOFF_SEC="${CIRCUIT_BREAKER_BACKOFF_SEC:-600}"
export STALE_GAP_ATTEMPTS="${STALE_GAP_ATTEMPTS:-10}"
export RECONCILE_EVERY_MIN="${RECONCILE_EVERY_MIN:-60}"
export PDF_AUDIT_EVERY_MIN="${PDF_AUDIT_EVERY_MIN:-120}"
export PDF_AUDIT_SAMPLE="${PDF_AUDIT_SAMPLE:-50}"
export SKIP_BACKFILL_ON_START="${SKIP_BACKFILL_ON_START:-1}"
[[ -n "${PARALLEL:-}" ]] && export PARALLEL
mkdir -p "$LOG_DIR"

# Portable lock (macOS has no flock). Stale locks auto-removed when holder pid is dead.
node "$ROOT/scripts/bulk-lock.js" acquire "$$"

cleanup() {
  echo ""
  echo "Shutting down — reconciling queue..."
  PARALLEL="${PARALLEL:-2}" npx ts-node "$ROOT/scripts/prune-cdp-tabs.ts" >>"$LOG_DIR/cdp-tab-prune.log" 2>&1 || true
  node "$ROOT/scripts/reconcile-queue.js" 2>/dev/null || true
  node "$ROOT/scripts/bulk-lock.js" release "$$" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec node "$ROOT/scripts/bulk-orchestrator.js" "$QUEUE"

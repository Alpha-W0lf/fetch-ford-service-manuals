#!/usr/bin/env bash
# Priority-aware bulk downloader with optional parallel workers.
# Polls the queue for new pending vehicles while workers run (no restart needed).
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
#   PDF_AUDIT_SAMPLE — PDFs to sample per spot-check (default: 50)   RECONCILE_EVERY_MIN — re-run reconcile-queue when no workers active (default: 60; 0=disable)
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
PARALLEL="${PARALLEL:-}"
POLL_SEC="${POLL_SEC:-15}"
IDLE_EXIT_MIN="${IDLE_EXIT_MIN:-0}"
COOKIE_REFRESH_MIN="${COOKIE_REFRESH_MIN:-180}"
CIRCUIT_BREAKER_THRESHOLD="${CIRCUIT_BREAKER_THRESHOLD:-2}"
STALE_GAP_ATTEMPTS="${STALE_GAP_ATTEMPTS:-10}"
RECONCILE_EVERY_MIN="${RECONCILE_EVERY_MIN:-60}"
PDF_AUDIT_EVERY_MIN="${PDF_AUDIT_EVERY_MIN:-120}"
PDF_AUDIT_SAMPLE="${PDF_AUDIT_SAMPLE:-50}"
export STALE_GAP_ATTEMPTS
LOCK_DIR="$LOG_DIR/bulk-download.lock"
BULK_LOCK_PID_FILE="$LOCK_DIR/pid"

bulk_lock_held_by_live_process() {
  if pgrep -f 'scripts/bulk-download.sh' >/dev/null 2>&1; then
    return 0
  fi
  if [[ -f "$BULK_LOCK_PID_FILE" ]]; then
    local lock_pid
    lock_pid=$(cat "$BULK_LOCK_PID_FILE" 2>/dev/null || true)
    [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null && return 0
  fi
  return 1
}

if [[ -d "$LOCK_DIR" ]]; then
  if bulk_lock_held_by_live_process; then
    echo "Another bulk-download.sh is already running (lock: $LOCK_DIR)."
    echo "Stop it first: pkill -f 'scripts/bulk-download.sh'"
    exit 1
  fi
  echo "Removing stale bulk lock (no live bulk-download.sh)"
  rm -rf "$LOCK_DIR"
fi

mkdir "$LOCK_DIR" || { echo "Could not acquire bulk lock"; exit 1; }
echo "$$" >"$BULK_LOCK_PID_FILE"
trap 'rm -rf "$LOCK_DIR" 2>/dev/null || true' EXIT

RECENT_403_FILE="$LOG_DIR/recent-403-stamps.txt"
BACKOFF_UNTIL=0
LAST_COOKIE_REFRESH=0
LAST_RECONCILE=$(date +%s)
LAST_PDF_AUDIT=$(date +%s)
LAST_RECONCILE=0
LAST_PDF_AUDIT=0

clear_auth_failure_stamps() {
  rm -f "$RECENT_403_FILE"
}

refresh_cookies() {
  if [[ "$COOKIE_REFRESH_MIN" == "0" ]]; then
    return 0
  fi
  if ! curl -sf http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    echo "[cookies] PTS Chrome CDP not available on :9222 — skip refresh"
    return 1
  fi
  echo "[cookies] Refreshing from PTS Chrome..."
  if node "$ROOT/scripts/export-cookies-from-chrome.js" >>"$LOG_DIR/cookie-refresh.log" 2>&1; then
    LAST_COOKIE_REFRESH=$(date +%s)
    clear_auth_failure_stamps
    echo "[cookies] Refreshed OK"
    return 0
  fi
  echo "[cookies] Refresh failed — see logs/cookie-refresh.log"
  return 1
}

maybe_refresh_cookies() {
  [[ "$COOKIE_REFRESH_MIN" == "0" ]] && return 0
  local now=$(date +%s)
  local due=$((LAST_COOKIE_REFRESH + COOKIE_REFRESH_MIN * 60))
  if [[ $LAST_COOKIE_REFRESH -eq 0 || $now -ge $due ]]; then
    if refresh_cookies; then
      connector_preflight || true
    fi
  fi
}

# Reconcile queue with disk when no workers are running (avoids vehicles.json races).
maybe_reconcile_queue() {
  [[ "$RECONCILE_EVERY_MIN" == "0" ]] && return 0
  local now=$(date +%s)
  local due=$((LAST_RECONCILE + RECONCILE_EVERY_MIN * 60))
  [[ $LAST_RECONCILE -ne 0 && $now -lt $due ]] && return 0
  echo "[reconcile] Periodic queue reconcile (every ${RECONCILE_EVERY_MIN}min, workers idle)..."
  node "$ROOT/scripts/reconcile-queue.js" >>"$LOG_DIR/reconcile-periodic.log" 2>&1 || true
  LAST_RECONCILE=$now
}

maybe_pdf_spot_check() {
  [[ "$PDF_AUDIT_EVERY_MIN" == "0" ]] && return 0
  local now=$(date +%s)
  local due=$((LAST_PDF_AUDIT + PDF_AUDIT_EVERY_MIN * 60))
  [[ $LAST_PDF_AUDIT -ne 0 && $now -lt $due ]] && return 0
  echo "[audit] PDF integrity spot-check (sample ${PDF_AUDIT_SAMPLE})..."
  if node "$ROOT/scripts/audit-pdf-integrity.js" --sample "$PDF_AUDIT_SAMPLE" \
    >>"$LOG_DIR/pdf-integrity-spotcheck.log" 2>&1; then
    echo "[audit] PDF spot-check OK — see logs/pdf-integrity-spotcheck.log"
  else
    echo "[audit] PDF spot-check found issues — see logs/pdf-integrity-spotcheck.log"
  fi
  LAST_PDF_AUDIT=$now
}

maybe_periodic_maintenance() {
  local running="${1:-0}"
  [[ "$running" -ne 0 ]] && return 0
  maybe_reconcile_queue
  maybe_pdf_spot_check
}

record_auth_failure() {
  local vid="$1"
  date +%s >>"$RECENT_403_FILE"
  echo "[circuit] Auth failure recorded for $vid"
}

auth_failure_is_recent() {
  local logfile="$1"
  grep -qE 'HTTP 403|Access Denied|403 Forbidden|Ford CDN returned Access Denied|subscriptionExpired|PTS auth redirect|Connector capture stopped after|Connector access: FAILED|Connector probe failed|Connector access check failed' "$logfile" 2>/dev/null \
    && ! grep -qE 'TSError|Unable to compile TypeScript' "$logfile" 2>/dev/null
}

connector_preflight() {
  echo "Preflight: connector portal access..."
  if ! npx ts-node "$ROOT/scripts/test-connector-cookies.ts" >>"$LOG_DIR/connector-preflight.log" 2>&1; then
    echo "Connector preflight FAILED — log into PTS Chrome and refresh cookies:"
    echo "  node scripts/export-cookies-from-chrome.js"
    tail -5 "$LOG_DIR/connector-preflight.log" 2>/dev/null || true
    return 1
  fi
  echo "Connector preflight OK"
  clear_auth_failure_stamps
  return 0
}

preflight_check() {
  echo "Preflight: TypeScript compile check..."
  if ! npx tsc --noEmit 2>"$LOG_DIR/preflight.err"; then
    echo "Preflight FAILED — fix TypeScript errors before bulk run:"
    cat "$LOG_DIR/preflight.err"
    exit 1
  fi
  echo "Preflight OK"
}

recent_auth_failure_count() {
  local now=$(date +%s) cutoff=$((now - 900)) count=0 ts
  [[ -f "$RECENT_403_FILE" ]] || { echo 0; return; }
  while IFS= read -r ts; do
    [[ -n "$ts" && "$ts" -ge "$cutoff" ]] && count=$((count + 1))
  done <"$RECENT_403_FILE"
  echo "$count"
}

trip_circuit_breaker() {
  local now=$(date +%s)
  BACKOFF_UNTIL=$((now + CIRCUIT_BREAKER_BACKOFF_SEC))
  echo ""
  echo "[circuit] $CIRCUIT_BREAKER_THRESHOLD+ auth failures — pausing new jobs for ${CIRCUIT_BREAKER_BACKOFF_SEC}s"
  refresh_cookies || true
}

circuit_breaker_active() {
  local now=$(date +%s)
  [[ $BACKOFF_UNTIL -gt $now ]]
}

if [[ ! -f "$QUEUE" ]]; then
  echo "Queue file not found: $QUEUE"
  exit 1
fi

if [[ ! -f "$ROOT/templates/cookieString.txt" ]]; then
  echo "Missing templates/cookieString.txt — refresh cookies from PTS first."
  exit 1
fi

if [[ -z "$PARALLEL" ]]; then
  PARALLEL=$(node -pe "JSON.parse(require('fs').readFileSync('$QUEUE','utf8')).parallel || 1")
fi

COOKIE_FILE=$(node -pe "JSON.parse(require('fs').readFileSync('$QUEUE','utf8')).cookieFile || 'templates/cookieString.txt'")

echo "Bulk downloader: parallel=$PARALLEL poll=${POLL_SEC}s idle_exit=${IDLE_EXIT_MIN}min cookie_refresh=${COOKIE_REFRESH_MIN}min"
preflight_check
echo "Reconciling queue with disk..."
echo "[reconcile] backfill-capture-gaps (may take a few minutes on large fleet)..."
node "$ROOT/scripts/backfill-capture-gaps.js" 2>/dev/null || true
echo "[reconcile] reconcile-queue..."
node "$ROOT/scripts/reconcile-queue.js"
LAST_RECONCILE=$(date +%s)
refresh_cookies || true
connector_preflight || {
  echo "WARNING: Connector preflight failed — new jobs may fail until cookies are refreshed."
  echo "         Keep PTS Chrome logged in; bulk will retry cookie export every ${COOKIE_REFRESH_MIN}min."
}

cleanup() {
  echo ""
  echo "Shutting down — reconciling queue..."
  PARALLEL="$PARALLEL" npx ts-node "$ROOT/scripts/prune-cdp-tabs.ts" >>"$LOG_DIR/cdp-tab-prune.log" 2>&1 || true
  node "$ROOT/scripts/reconcile-queue.js" 2>/dev/null || true
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mark_status() {
  local vid="$1" status="$2"
  node "$ROOT/scripts/patch-queue.js" "$vid" "$status"
}

verify_download() {
  local OUT="$1" WORKSHOP="$2" WIRING="$3"
  OUT="$OUT" WANT_W="$WORKSHOP" WANT_I="$WIRING" ROOT="$ROOT" node -e "
const { verifyDownload } = require('./scripts/verify-download-lib');
const r = verifyDownload(process.env.ROOT, process.env.OUT, process.env.WANT_W==='true', process.env.WANT_I==='true');
process.exit(r.ok ? 0 : 1);
"
}

# Prints: complete | incomplete | failed
download_status() {
  local OUT="$1" WORKSHOP="$2" WIRING="$3"
  OUT="$OUT" WANT_W="$WORKSHOP" WANT_I="$WIRING" ROOT="$ROOT" node -e "
const { verifyDownload } = require('./scripts/verify-download-lib');
const { hasCaptureGaps } = require('./scripts/capture-gaps-lib');
const r = verifyDownload(process.env.ROOT, process.env.OUT, process.env.WANT_W==='true', process.env.WANT_I==='true');
if (r.ok) process.stdout.write('complete');
else if (hasCaptureGaps(process.env.ROOT, process.env.OUT)) process.stdout.write('incomplete');
else process.stdout.write('failed');
"
}

run_one() {
  local VID="$1" PARAMS="$2" OUT="$3" WORKSHOP="$4" WIRING="$5"
  if [[ ! -f "$ROOT/$PARAMS" ]]; then
    echo "MISSING params for $VID — marking needs_params"
    mark_status "$VID" "needs_params"
    return 2
  fi

  if verify_download "$OUT" "$WORKSHOP" "$WIRING"; then
    echo "SKIP $VID — already verified on disk"
    mark_status "$VID" "complete"
    return 0
  fi

  bash "$ROOT/scripts/clean-partial-download.sh" "$VID" 2>/dev/null || true
  mkdir -p "$ROOT/$OUT"
  mark_status "$VID" "downloading"

  # Fresh cookies from PTS Chrome before each vehicle (connectors need live portal session).
  refresh_cookies || true

  local FLAGS=(--noCookieTest --ignoreSaveErrors --noParamsValidation)
  [[ "$WORKSHOP" == "false" ]] && FLAGS+=(--noWorkshop)
  [[ "$WIRING" == "false" ]] && FLAGS+=(--noWiring)

  local CONNECTORS_ONLY
  CONNECTORS_ONLY=$(OUT="$OUT" ROOT="$ROOT" node -e "
const { shouldConnectorOnlyRetry } = require('./scripts/verify-download-lib');
process.stdout.write(shouldConnectorOnlyRetry(process.env.ROOT, process.env.OUT) ? 'true' : 'false');
")
  if [[ "$CONNECTORS_ONLY" == "true" && "$WIRING" != "false" ]]; then
    echo "  mode: connectors-only retry (workshop/wiring pages already on disk)"
    FLAGS+=(--noWorkshop --connectorsOnly)
  fi

  local STALE_FLAG
  STALE_FLAG=$(OUT="$OUT" ROOT="$ROOT" node -e "
const { isStaleIncomplete } = require('./scripts/queue-lib');
process.stdout.write(isStaleIncomplete(process.env.ROOT, process.env.OUT) ? 'true' : 'false');
" 2>/dev/null || echo "false")
  if [[ "$STALE_FLAG" == "true" ]]; then
    echo "  mode: stale-gap retry (deprioritized — every gap has ${STALE_GAP_ATTEMPTS:-10}+ attempts)"
  fi

  echo ""
  echo "========================================"
  echo "START $VID (parallel slot)"
  echo "  params: $PARAMS"
  echo "  output: $OUT"
  echo "  log:    logs/${VID}.log"
  echo "========================================"

  set +e
  # Full detail → vehicle log only; orchestrator log stays START/OK/FAIL lines.
  yarn start -c "$PARAMS" -s "$COOKIE_FILE" -o "$OUT" "${FLAGS[@]}" 2>&1 | tee "$LOG_DIR/${VID}.log" >/dev/null
  local EXIT=${PIPESTATUS[0]}
  set -e

  # Close orphan connector-capture tabs left by crashed jobs (keeps up to PARALLEL active tabs).
  PARALLEL="$PARALLEL" npx ts-node "$ROOT/scripts/prune-cdp-tabs.ts" >>"$LOG_DIR/cdp-tab-prune.log" 2>&1 || true

  local STATUS
  STATUS=$(download_status "$OUT" "$WORKSHOP" "$WIRING")

  if [[ $EXIT -eq 0 && "$STATUS" == "complete" ]]; then
    echo "OK: $VID (verified, no gaps)"
    mark_status "$VID" "complete"
    return 0
  fi
  if [[ "$STATUS" == "incomplete" && $EXIT -eq 0 ]]; then
  echo "INCOMPLETE: $VID — capture gaps remain (see $OUT/capture-gaps.json)"
    mark_status "$VID" "incomplete"
    return 1
  fi
  if [[ "$STATUS" == "incomplete" && $EXIT -ne 0 ]]; then
    echo "FAIL: $VID (exit $EXIT during run; gaps on disk) — see logs/${VID}.log"
    if auth_failure_is_recent "$LOG_DIR/${VID}.log"; then
      record_auth_failure "$VID"
    fi
    mark_status "$VID" "failed"
    return 1
  fi
  echo "FAIL: $VID (exit $EXIT or incomplete download) — see logs/${VID}.log"
  if auth_failure_is_recent "$LOG_DIR/${VID}.log"; then
    record_auth_failure "$VID"
  fi
  mark_status "$VID" "failed"
  return 1
}

# Return count of pending/failed vehicles (excluding in-flight ids passed as $1)
count_pending() {
  local exclude_csv="${1:-}"
  EXCLUDE_CSV="$exclude_csv" QUEUE_PATH="$QUEUE" ROOT="$ROOT" node -e "
const { countPending } = require('./scripts/queue-lib');
const exclude = (process.env.EXCLUDE_CSV || '').split(',').filter(Boolean);
process.stdout.write(String(countPending(process.env.ROOT, process.env.QUEUE_PATH, exclude)));
"
}

# Print one highest-priority job line (tab-separated), excluding in-flight ids
next_job() {
  local exclude_csv="${1:-}"
  EXCLUDE_CSV="$exclude_csv" QUEUE_PATH="$QUEUE" ROOT="$ROOT" node -e "
const { nextJob } = require('./scripts/queue-lib');
const exclude = (process.env.EXCLUDE_CSV || '').split(',').filter(Boolean);
const job = nextJob(process.env.ROOT, process.env.QUEUE_PATH, exclude);
if (!job) process.exit(1);
const { v, workshop, wiring } = job;
console.log([v.id, v.paramsFile, v.outputDir, workshop, wiring].join('\t'));
"
}

join_csv() {
  if ((${#@} == 0)); then
    echo ""
  else
    local IFS=,
    echo "$*"
  fi
}

in_flight_exclude_csv() {
  if ((${#IN_FLIGHT_VIDS[@]})); then
    join_csv "${IN_FLIGHT_VIDS[@]}"
  else
    echo ""
  fi
}

FAILURES=0
IDLE_TICKS=0
IN_FLIGHT_VIDS=()
IN_FLIGHT_PIDS=()

reap_workers() {
  local new_vids=() new_pids=()
  local i pid vid
  if ((${#IN_FLIGHT_PIDS[@]})); then
    for i in "${!IN_FLIGHT_PIDS[@]}"; do
      pid="${IN_FLIGHT_PIDS[$i]}"
      vid="${IN_FLIGHT_VIDS[$i]}"
      if kill -0 "$pid" 2>/dev/null; then
        new_vids+=("$vid")
        new_pids+=("$pid")
      else
        if wait "$pid"; then
          :
        else
          FAILURES=$((FAILURES + 1))
        fi
      fi
    done
  fi
  if ((${#new_vids[@]})); then
    IN_FLIGHT_VIDS=("${new_vids[@]}")
    IN_FLIGHT_PIDS=("${new_pids[@]}")
  else
    IN_FLIGHT_VIDS=()
    IN_FLIGHT_PIDS=()
  fi
}

start_workers() {
  local exclude_csv running job VID PARAMS OUT WORKSHOP WIRING
  if circuit_breaker_active; then
    return
  fi
  local failures
  failures=$(recent_auth_failure_count)
  if [[ "$failures" -ge "$CIRCUIT_BREAKER_THRESHOLD" ]]; then
    trip_circuit_breaker
    return
  fi
  while true; do
    running=${#IN_FLIGHT_PIDS[@]}
    [[ $running -ge $PARALLEL ]] && break

    exclude_csv=$(in_flight_exclude_csv)
    job=$(next_job "$exclude_csv" 2>/dev/null) || break

    IFS=$'\t' read -r VID PARAMS OUT WORKSHOP WIRING <<< "$job"
    (
      run_one "$VID" "$PARAMS" "$OUT" "$WORKSHOP" "$WIRING"
    ) &
    IN_FLIGHT_VIDS+=("$VID")
    IN_FLIGHT_PIDS+=($!)
  done
}

idle_limit_ticks() {
  if [[ "$IDLE_EXIT_MIN" == "0" ]]; then
    echo "999999999"
  else
    echo $((IDLE_EXIT_MIN * 60 / POLL_SEC))
  fi
}

MAX_IDLE_TICKS=$(idle_limit_ticks)

while true; do
  reap_workers
  maybe_refresh_cookies
  running=${#IN_FLIGHT_PIDS[@]}
  maybe_periodic_maintenance "$running"
  if circuit_breaker_active; then
    if [[ $running -eq 0 ]] && refresh_cookies; then
      echo "[circuit] Cookies refreshed with no workers — resuming job queue"
      BACKOFF_UNTIL=0
      start_workers
    else
      now=$(date +%s)
      remaining=$((BACKOFF_UNTIL - now))
      echo "[circuit] Backoff active — ${remaining}s until new jobs (${running} worker(s) still running)"
    fi
  else
    start_workers
  fi

  running=${#IN_FLIGHT_PIDS[@]}
  exclude_csv=$(in_flight_exclude_csv)
  pending=$(count_pending "$exclude_csv")

  if [[ $running -eq 0 && "$pending" == "0" ]]; then
    IDLE_TICKS=$((IDLE_TICKS + 1))
    if [[ $IDLE_TICKS -ge $MAX_IDLE_TICKS ]]; then
      echo ""
      echo "No pending work for ${IDLE_EXIT_MIN} minutes — exiting."
      break
    fi
    echo "[poll] waiting for pending vehicles (${IDLE_TICKS}/${MAX_IDLE_TICKS} idle checks, poll ${POLL_SEC}s)..."
    sleep "$POLL_SEC"
    continue
  fi

  IDLE_TICKS=0
  if [[ $running -gt 0 ]]; then
    sleep 5
  else
    sleep "$POLL_SEC"
  fi
done

echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo "Bulk run finished with no failures."
else
  echo "Bulk run finished with $FAILURES failure(s)."
  exit 1
fi

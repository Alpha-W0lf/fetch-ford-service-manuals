# Environment variables

Variables read by the bulk pipeline. Defaults shown are code defaults when unset.

---

## Bulk orchestrator (`scripts/bulk-download.sh` → `scripts/bulk-orchestrator.js`)

Implementation: `lib/bulk-orchestrator-lib.js`, `lib/bulk-circuit-breaker.js`, `lib/bulk-download-status.js`, `lib/bulk-auth-log.js`, `lib/vehicle-cooldown.js`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PARALLEL` | from queue or `2` | Concurrent `yarn start` workers |
| `POLL_SEC` | `15` | Queue poll interval when idle |
| `IDLE_EXIT_MIN` | `0` | Exit after N min idle (`0` = never) |
| `COOKIE_REFRESH_MIN` | `180` | Refresh cookies from PTS Chrome (`0` = off) |
| `SKIP_BACKFILL_ON_START` | `1` | Skip `backfill-capture-gaps` on boot |
| `RECONCILE_EVERY_MIN` | `60` | Periodic reconcile when idle (`0` = startup only) |
| `PDF_AUDIT_EVERY_MIN` | `120` | PDF spot-check when idle (`0` = off) |
| `PDF_AUDIT_SAMPLE` | `50` | PDFs per spot-check |
| `CIRCUIT_BREAKER_THRESHOLD` | `2` | Auth failures before backoff |
| `CIRCUIT_BREAKER_BACKOFF_SEC` | `600` | Pause after auth circuit trip |
| `STALE_GAP_ATTEMPTS` | `10` | Deprioritize stale `incomplete` |
| `WORKER_LOG_STALE_MS` | `1200000` | Kill alive worker if vehicle log mtime older than this (`0` = off) — Guide 04.2 |
| `WORKER_MAX_RUNTIME_MS` | `14400000` | Kill worker after wall-clock runtime since `downloading` (`0` = off) |
| `WORKER_KILL_GRACE_MS` | `5000` | Wait after SIGTERM before SIGKILL on hung worker |
| `PRUNE_ORPHAN_MAX_AGE_MIN` | `30` | Reap orphan `prune-cdp-tabs` processes older than this (`0` = off) |
| `VEHICLE_FAST_FAIL_SEC` | `60` | Job runtime below this counts as fast-fail for auth INCOMPLETE cooldown — Guide 04.3 |
| `VEHICLE_FAST_FAIL_COUNT` | `3` | Fast auth INCOMPLETE outcomes before per-vehicle cooldown |
| `VEHICLE_COOLDOWN_SEC` | `900` | Exclude vehicle from dispatch after fast-fail threshold (15 min) |
| `VEHICLE_COOLDOWN_FILE` | `logs/vehicle-cooldown.json` | Persistent per-vehicle cooldown state |
| `VEHICLE_AUTH_EVENTS_FILE` | `logs/recent-auth-events.jsonl` | Append-only auth INCOMPLETE audit log |
| `EXCLUDE_CSV` | — | Comma-separated vehicle IDs to skip (internal; in-flight workers) |

---

## HTTP retry (`src/httpRetry.ts`, `src/client.ts`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `HTTP_MAX_RETRIES` | `5` | Max retries per request |
| `HTTP_RETRY_BASE_DELAY_MS` | `1000` | Initial backoff |
| `HTTP_RETRY_MAX_DELAY_MS` | `30000` | Backoff cap |
| `HTTP_RETRY_BUDGET_MS` | `120000` | Max wall time retrying one request |
| `HTTP_REQUEST_TIMEOUT_MS` | `90000` | Axios socket timeout per attempt |

---

## CDP / Chrome (`:9222`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CDP_URL` | `http://127.0.0.1:9222` | Chrome DevTools endpoint |
| `CDP_LOCK_WAIT_MS` | `600000` | Max wait to acquire CDP lock (connectors, capture retry pass) |
| `CDP_LOCK_YIELD_MS` | `120000` | Capture first pass: wait then defer if busy |
| `CDP_CONNECT_TIMEOUT_MS` | `120000` / `30000` | Connect timeout (context-dependent) |
| `CDP_DISCONNECT_TIMEOUT_MS` | `10000` | Max wait for `browser.close()` after CDP tab prune (Guide 04.1) |
| `CDP_CONNECT_ATTEMPTS` | `5` | Capture connect retries |
| `CDP_BACKGROUND_TAB` | `1` (on) | Open connector tabs in background (`0` = disable) |
| `USE_CDP` | on | Capture: set `false` to force headless |
| `HEADLESS_BROWSER` | on | Playwright headless unless `false` |

---

## Queue patch (`lib/patch-queue.js`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PATCH_QUEUE_LOCK_MS` | `30000` | Max wait for `vehicles.json.patch-lock` before patch fails |

---

## Param capture pacing (`scripts/capture-params.ts`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAPTURE_DELAY_SEC` | `4` | Delay between vehicles |
| `CAPTURE_PAUSE_EVERY` | `25` | Pause every N vehicles |
| `CAPTURE_PAUSE_SEC` | `60` | Pause duration |
| `CAPTURE_MAX_CONSECUTIVE_FAILS` | `5` | Stop after N consecutive failures |

---

## Hybrid complete / gaps (`scripts/capture-gaps-lib.js`, `src/captureGaps.ts`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `HYBRID_COMPLETE_MAX_GAPS` | `5` | Max connector-audit gaps for hybrid complete |
| `HYBRID_COMPLETE_MIN_ATTEMPTS` | `3` | Min attempts per gap for hybrid complete |

---

## Workshop / misc

| Variable | Default | Purpose |
|----------|---------|---------|
| `WORKSHOP_AUTH_REFRESH_THRESHOLD` | `5` | Re-auth workshop client after N consecutive auth-class failures (one cookie refresh per run) |
| `WORKSHOP_AUTH_STOP_THRESHOLD` | `10` | Consecutive auth-class failures before in-worker workshop stop (`[auth-budget-stop]`); must be **>** refresh threshold |
| `WORKSHOP_AUTH_STOP_ENABLED` | `1` | Set `0` to disable workshop auth-budget stop (rollback without code revert) |
| `PDF_AUDIT_MIN_BYTES` | `200` | Minimum PDF size in integrity audit |
| `USE_PROXY` | off | Proxy for HTTP client |
| `CONNECTOR_PROBE_VEHICLE` | — | Debug probe vehicle id |
| `CONNECTOR_PROBE_INDEX` | `0` | Debug connector index |

---

## Cookie refresh standalone

`scripts/cookie-refresh-loop.sh`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `COOKIE_REFRESH_SEC` | `10800` | Loop interval (3h) |

---

## Watchdog (`scripts/ensure-bulk-running.sh`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `WATCHDOG_COOLDOWN_SEC` | `600` | Min seconds between auto-restarts |
| `WATCHDOG_STALL_WORKERS_MIN` | `20` | Treat as stall when bulk running, 0 yarn workers, queue has `downloading`, and latest bulk log mtime older than this (minutes) |

---

## CI / testing (Dev Guide 02 — planned)

| Variable | Purpose |
|----------|---------|
| `NODE_ENV=test` | Test harness isolation |
| Fixture paths | Under `test/fixtures/` only |

No PTS credentials or live CDP in default CI.

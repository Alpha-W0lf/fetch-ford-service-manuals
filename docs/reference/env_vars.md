# Environment variables

Variables read by the bulk pipeline. Defaults shown are code defaults when unset.

---

## Bulk orchestrator (`scripts/bulk-download.sh`)

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
| `CIRCUIT_BREAKER_BACKOFF_SEC` | `600` (documented) | Pause after auth circuit trip — **note:** comment documents default but bash line assignment is missing in `bulk-download.sh`; fix in Guide 04 or small hotfix |
| `STALE_GAP_ATTEMPTS` | `10` | Deprioritize stale `incomplete` |
| `EXCLUDE_CSV` | — | Comma-separated vehicle IDs to skip (internal) |
| `ROOT` | repo root | Set by bash for inline `node -e` |

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
| `CDP_CONNECT_ATTEMPTS` | `5` | Capture connect retries |
| `CDP_BACKGROUND_TAB` | `1` (on) | Open connector tabs in background (`0` = disable) |
| `USE_CDP` | on | Capture: set `false` to force headless |
| `HEADLESS_BROWSER` | on | Playwright headless unless `false` |

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
| `WORKSHOP_AUTH_REFRESH_THRESHOLD` | `5` | Re-auth workshop client after N failures |
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

## CI / testing (Dev Guide 02 — planned)

| Variable | Purpose |
|----------|---------|
| `NODE_ENV=test` | Test harness isolation |
| Fixture paths | Under `test/fixtures/` only |

No PTS credentials or live CDP in default CI.

# Dev Guide 04: Bulk Orchestrator Split (Node)

## 🎯 Objective

Replace the 500-line `bulk-download.sh` hot path with a tested Node orchestrator and a thin bash wrapper for Terminal.app / `caffeinate` / `nohup` — without changing fleet behavior.

## 📚 Critical Context & References

* **Architecture:** `docs/reference/architecture.md`
* **State machine:** `docs/reference/queue_state_machine.md`
* **Current orchestrator:** `scripts/bulk-download.sh` (506 lines)
* **Queue libs:** `scripts/queue-lib.js`, `lib/patch-queue.js`, `scripts/reconcile-queue.js`, `scripts/verify-download-lib.js`
* **Ops snapshot:** `docs/2026-07-08_pipeline_inventory_and_action_items.md` (orphaned `downloading` bug)
* **Tests:** Dev Guides 02–03 complete (`yarn test` — 58+ tests)
* **Agent:** `AGENTS.md` invariant #5 — **do not refactor during active bulk**

**Gate:** Bulk **stopped** + operator confirmation + `yarn test` green.

## 🏗️ Architectural Pattern

> **Pattern:** Node orchestrator + bash supervisor shell  
> **Flow:** `start-bulk-in-terminal.sh` → bash (caffeinate, env) → `node scripts/bulk-orchestrator.js`  
> **Constraint:** Bash retains only: Terminal launch, `caffeinate`, lock acquire bootstrap, env export. All queue logic in Node.

```
start-bulk-in-terminal.sh
  └── bulk-download.sh (~80 lines wrapper)
        └── bulk-orchestrator.js (poll, workers, cookies, reconcile triggers)
              └── spawn yarn start per vehicle
```

### `bulk-download.sh` code map (parity source)

| Bash symbol | Lines (approx) | Node target |
|-------------|----------------|-------------|
| `refresh_cookies` / `maybe_refresh_cookies` | 65–93 | `maybeCookieRefresh()` |
| `maybe_reconcile_queue` / `maybe_pdf_spot_check` | 96–126 | `maybePeriodicMaintenance(running)` |
| `record_auth_failure` / `circuit_breaker_*` | 128–180 | `lib/bulk-circuit-breaker.js` |
| `mark_status` | 229–232 | `lib/patch-queue.patchVehicleStatus` |
| `verify_download` / `download_status` | 234–254 | `verify-download-lib` wrappers |
| `run_one` | 256–344 | `spawnWorker()` + status from verify |
| `count_pending` / `next_job` | 347–367 | `queue-lib` (already JS) |
| `reap_workers` | 391–417 | `reapWorkers()` + **orphan status fix** |
| `start_workers` | 419–444 | `startWorkers()` |
| Main poll loop | 456–497 | `orchestratorLoop()` |

### Inline `node -e` blocks to eliminate (6)

1. `verify_download` — verifyDownload exit code  
2. `download_status` — complete \| incomplete \| failed  
3. `CONNECTORS_ONLY` — shouldConnectorOnlyRetry  
4. `STALE_FLAG` — isStaleIncomplete  
5. `count_pending` — queue-lib  
6. `next_job` — queue-lib  

### Known bug to fix in Guide 04 (from live ops 2026-07-08)

**Orphaned `downloading`:** Worker subprocess exits but queue stays `downloading` (vehicles excluded from `next_job` / `isQueued`). Periodic reconcile only runs every `RECONCILE_EVERY_MIN` when `running===0`.

**Fix in `reapWorkers()`:** When PID dead, if queue status is still `downloading` for that vehicle id, run `download_status` + `patch-queue` to `incomplete`/`complete`/`failed`/`pending`.

### Proposed file layout

```
scripts/
  bulk-orchestrator.js          # CLI entry, main loop
  bulk-download.sh              # thin wrapper (kept for compatibility)
lib/
  bulk-orchestrator-lib.js      # poll, spawn, reap, maintenance
  bulk-circuit-breaker.js       # auth failure stamps, backoff
test/
  bulk-orchestrator.test.ts     # mocked spawn, circuit breaker, reap orphan fix
```

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [x] **Bulk run stopped** (operator confirmation in Terminal.app)
* [x] **Capture stopped** (recommended for soak test)
* [x] Dev Guides 02–03 complete; `yarn test` green
* [x] Run `node scripts/reconcile-queue.js` once after stop to fix orphaned `downloading`
* [ ] Snapshot parity: log excerpts from `run_one`, env passed to `yarn start`, queue transitions
* [x] `CIRCUIT_BREAKER_BACKOFF_SEC` default — done in Guide 02

### Step 1: Design `bulk-orchestrator.js`

* [x] Map all env vars from `docs/reference/env_vars.md` bulk section
* [x] Modules per layout above
* [x] Preserve: `PARALLEL`, `POLL_SEC`, `EXCLUDE_CSV` in-flight tracking, connector-only retry, stale-gap flags
* [x] **Include orphan `downloading` fix in reap**
* [x] No new features — parity refactor only

### Step 2: Extract incrementally (strangler)

* [x] Phase A: `lib/bulk-orchestrator-lib.js` — port bash helpers + eliminate `node -e`
* [x] Phase B: `bulk-orchestrator.js` main loop replaces bash loop
* [x] Phase C: Thin `bulk-download.sh` to env + `exec node scripts/bulk-orchestrator.js`
* [x] Keep `bulk-download.sh` as compatibility wrapper one release cycle

### Step 3: Tests

* [x] `test/bulk-orchestrator.test.ts` — fixture queue in `test/fixtures/`
* [x] Mock `child_process.spawn` for `yarn start` — verify args/env
* [x] Circuit breaker after N auth failures
* [x] Reap worker: orphaned `downloading` → patched from disk verify
* [x] Reconcile only when worker count = 0

### Step 4: Start scripts

* [x] Update `docs/reference/architecture.md`, `PIPELINE_OPS.md`
* [x] `start-bulk-download.sh`, `start-bulk-in-terminal.sh` — unchanged (still invoke `bulk-download.sh`)

### Step 5: Deprecation

* [ ] Git history reference for removed bash loop
* [ ] Do **not** remove watchdog in this guide (Phase G)

## ✅ Verification & Definition of Done

* [ ] `./scripts/start-bulk-in-terminal.sh` starts orchestrator; PPID=1 after detach
* [ ] 2 workers parallel; `patch-queue` updates statuses
* [x] Graceful shutdown (SIGINT/SIGTERM waits for in-flight workers)
* [x] `needs_params` (exit 2) not counted as bulk failure
* [x] Periodic reconcile + PDF audit on idle (parity with bash)
* [x] `yarn test` + **30-min soak** on 2–3 vehicles (soak pending operator)
* [ ] `queue-status.sh --health` output shape unchanged

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Orchestrator dies on start | **Critical** | Bulk stopped; soak before subscription reliance |
| Queue status corruption | **High** | `patch-queue` lock + integration tests |
| Worker spawn env drift | High | Snapshot env before/after refactor |
| Orphan downloading regression | **High** | Explicit reap test (live bug today) |
| Operator script confusion | Medium | Single blessed path in PIPELINE_OPS |

**Rollback:** `git revert` + restore bash orchestrator + Terminal restart.

**Safe during active bulk:** **NO**

---

**Status:** **Executed** 2026-07-08 — operator soak + production restart pending  
**Depends on:** Dev Guides 02, 03; **bulk stopped**  
**Blocks:** None (Guide 05 can proceed in parallel if capture-only)

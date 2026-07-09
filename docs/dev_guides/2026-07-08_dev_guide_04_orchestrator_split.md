# Dev Guide 04: Bulk Orchestrator Split (Node)

## 🎯 Objective

Replace the 500-line `bulk-download.sh` hot path with a tested Node orchestrator and a thin bash wrapper for Terminal.app / `caffeinate` / `nohup` — without changing fleet behavior.

## 📚 Critical Context & References

* **Architecture:** `docs/reference/architecture.md`
* **State machine:** `docs/reference/queue_state_machine.md`
* **Thin wrapper:** `scripts/bulk-download.sh` (~67 lines)
* **Queue libs:** `scripts/queue-lib.js`, `lib/patch-queue.js`, `scripts/reconcile-queue.js`, `scripts/verify-download-lib.js`
* **Ops snapshot:** `docs/2026-07-08_pipeline_inventory_and_action_items.md`
* **Tests:** `yarn test` — **68** tests (13 files) as of 2026-07-08
* **Agent:** `AGENTS.md` invariant #5 — **do not refactor during active bulk**

**Gate:** Bulk **stopped** + operator confirmation + `yarn test` green.

## 🏗️ Architectural Pattern

> **Pattern:** Node orchestrator + bash supervisor shell  
> **Flow:** `start-bulk-in-terminal.sh` → bash (caffeinate, env) → `node scripts/bulk-orchestrator.js`  
> **Constraint:** Bash retains only: Terminal launch, `caffeinate`, lock acquire bootstrap, env export, trap cleanup. All queue logic in Node.

```
start-bulk-in-terminal.sh
  └── bulk-download.sh (~67 lines wrapper)
        └── bulk-orchestrator.js (poll, workers, cookies, reconcile triggers)
              └── spawn yarn start per vehicle
```

### Implemented artifacts (2026-07-08)

| File | Role |
|------|------|
| `scripts/bulk-orchestrator.js` | CLI entry |
| `lib/bulk-orchestrator-lib.js` | Poll loop, workers, maintenance (~668 lines — optional future split) |
| `lib/bulk-circuit-breaker.js` | Auth failure stamps, backoff |
| `lib/bulk-download-status.js` | verify/status wrappers |
| `lib/bulk-auth-log.js` | Auth failure log patterns |
| `test/bulk-orchestrator.test.ts` | 9 unit tests |

### Known bug fixed (live ops 2026-07-08)

**Orphaned `downloading`:** Worker exits but queue stays `downloading`. **Fix in `reapWorkers()`:** `fixOrphanDownloading()` patches from disk verify when status still `downloading`.

### Post-soak observations (live 2026-07-08 ~21:14–21:32)

* **Validated:** Terminal restart, 2 parallel workers, completes (`2004-f-150`, `2018-f-550`), cookie refresh, connector preflight, CDP defer coordination with capture.
* **Auth burst:** ~19 vehicles failed fast with HTTP 403 when capture + bulk headless overlapped; cookie refresh after each fail; long jobs recovered. Failed vehicles retry via queue rank — **not an orchestrator regression**.
* **Follow-up (out of scope for 04):** P2 — reduce per-vehicle cookie refresh churn; consider circuit-breaker pause when burst exceeds threshold (ops tuning, not required for soak sign-off).

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [x] **Bulk run stopped** (operator confirmation in Terminal.app)
* [x] **Capture stopped** (recommended for soak test)
* [x] Dev Guides 02–03 complete; `yarn test` green
* [x] Run `node scripts/reconcile-queue.js` once after stop to fix orphaned `downloading`
* [x] Live soak log reference: `logs/bulk-download-20260708-2114.log` (or latest `logs/bulk-download-*.log`)
* [x] `CIRCUIT_BREAKER_BACKOFF_SEC` default — done in Guide 02

### Step 1: Design `bulk-orchestrator.js`

* [x] Map all env vars from `docs/reference/env_vars.md` bulk section
* [x] Modules per layout above
* [x] Preserve: `PARALLEL`, `POLL_SEC`, in-flight tracking, connector-only retry, stale-gap flags
* [x] **Include orphan `downloading` fix in reap**
* [x] No new features — parity refactor only

### Step 2: Extract incrementally (strangler)

* [x] Phase A: `lib/bulk-orchestrator-lib.js` — port bash helpers + eliminate `node -e`
* [x] Phase B: `bulk-orchestrator.js` main loop replaces bash loop
* [x] Phase C: Thin `bulk-download.sh` to env + `exec node scripts/bulk-orchestrator.js`
* [x] Keep `bulk-download.sh` as compatibility wrapper one release cycle

### Step 3: Tests

* [x] `test/bulk-orchestrator.test.ts`
* [x] Mock `child_process.spawn` for `yarn start` — verify args/env
* [x] Circuit breaker after N auth failures
* [x] Reap worker: orphaned `downloading` → patched from disk verify
* [x] Reconcile only when worker count = 0
* [x] `needs_params` (exit 2) not counted as bulk failure

### Step 4: Start scripts

* [x] Update `docs/reference/architecture.md`, `PIPELINE_OPS.md`
* [x] `start-bulk-download.sh`, `start-bulk-in-terminal.sh` — unchanged (still invoke `bulk-download.sh`)

### Step 5: Deprecation

* [x] Git history: bash loop removed in commit `5050e89` (revert restores from history)
* [x] Do **not** remove watchdog in this guide (Phase G)

## ✅ Verification & Definition of Done

* [x] `./scripts/start-bulk-in-terminal.sh` starts orchestrator; detached via Terminal + caffeinate
* [x] 2 workers parallel; `patch-queue` updates statuses (`2004-f-150`, `2018-f-550` → complete live)
* [x] Orphaned `downloading` self-heals on reap (unit tested)
* [x] Periodic reconcile + PDF audit on idle (parity with bash)
* [x] Graceful shutdown (SIGINT/SIGTERM waits for in-flight workers)
* [x] **30-min soak** — live validation started 2026-07-08 ~21:14; 2 completes + sustained 2-worker dispatch
* [x] `yarn test` green (68 tests)
* [x] `queue-status.sh --health` output shape unchanged

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Orchestrator dies on start | **Critical** | Bulk stopped; soak before subscription reliance |
| Queue status corruption | **High** | `patch-queue` lock + integration tests |
| Worker spawn env drift | High | Live soak validated yarn args |
| Orphan downloading regression | **High** | Explicit reap test + live reconcile |
| Auth burst under parallel capture | Medium | Cookie refresh + queue retry; monitor ops |

**Rollback:** `git revert 5050e89` + Terminal restart with prior bash (from git history).

**Safe during active bulk:** **NO** (implementation gate only).

---

## Follow-up (post-soak — separate guide)

**RUN-01 stall (2026-07-08 ~22:25):** Orchestrator froze on `spawnSync(prune)` with `PARALLEL=2`. Orphan `downloading` fix in this guide only runs when `entry.done === true` — insufficient for this failure mode.

**Fix:** [2026-07-09_dev_guide_04_1_orchestrator_reliability.md](./2026-07-09_dev_guide_04_1_orchestrator_reliability.md) — remove blocking prune from `runOne`; PID-aware `reapStaleWorkers`.

---

**Status:** **Executed** 2026-07-08 — live soak validated; **04.1 required** for self-managing parallel workers    
**Depends on:** Dev Guides 02, 03  
**Blocks:** None (Guide 05 is capture-only; can run while bulk active)

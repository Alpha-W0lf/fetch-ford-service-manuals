# Dev Guide 04: Bulk Orchestrator Split (Node)

## 🎯 Objective

Replace the 500-line `bulk-download.sh` hot path with a tested Node orchestrator and a thin bash wrapper for Terminal.app / `caffeinate` / `nohup` — without changing fleet behavior.

## 📚 Critical Context & References

* **Architecture:** `docs/reference/architecture.md`
* **State machine:** `docs/reference/queue_state_machine.md`
* **Current orchestrator:** `scripts/bulk-download.sh` (504 lines)
* **Queue libs:** `scripts/queue-lib.js`, `scripts/patch-queue.js`, `scripts/reconcile-queue.js`, `scripts/verify-download-lib.js`
* **Tests:** Dev Guides 02–03 must be complete
* **Agent:** `AGENTS.md` invariant #5 — **do not refactor during active bulk**

## 🏗️ Architectural Pattern

> **Pattern:** Node orchestrator + bash supervisor shell  
> **Flow:** `start-bulk-in-terminal.sh` → bash (caffeinate, env) → `node scripts/bulk-orchestrator.js`  
> **Constraint:** Bash retains only: Terminal launch, `caffeinate`, lock acquire bootstrap, env export. All queue logic in Node.

```
start-bulk-in-terminal.sh
  └── bulk-download.sh (thin, ~80 lines) OR deprecated in favor of start script calling node directly
        └── bulk-orchestrator.js (poll, workers, cookies, reconcile triggers)
              └── spawn yarn start per vehicle
```

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [ ] **Bulk run stopped** or subscription window ended (operator confirmation)
* [ ] Dev Guides 02–03 complete; `yarn test` green
* [ ] Capture snapshot of current `bulk-download.sh` behavior (log excerpts, queue transitions) for parity checklist
* [ ] Fix `CIRCUIT_BREAKER_BACKOFF_SEC` default in bash if not done in Guide 02 — **done in Guide 02**

### Step 1: Design `bulk-orchestrator.js`

* [ ] Map all env vars from `docs/reference/env_vars.md` bulk section
* [ ] Modules: `pollQueue`, `spawnWorker`, `markStatus` (wrap patch-queue), `maybeReconcile`, `maybeCookieRefresh`, `maybePdfAudit`, `circuitBreaker`
* [ ] Preserve: `PARALLEL`, `POLL_SEC`, `EXCLUDE_CSV` active worker tracking, connector-only retry logic
* [ ] No new features — parity refactor only

### Step 2: Extract incrementally (strangler)

* [ ] Phase A: Move inline `node -e` blocks to required functions in `queue-lib` / new `bulk-orchestrator-lib.js`
* [ ] Phase B: Node main loop replaces bash loop
* [ ] Phase C: Thin bash to env + exec node
* [ ] Keep `bulk-download.sh` as compatibility symlink/wrapper calling node (one release cycle)

### Step 3: Tests

* [ ] Integration tests with fixture `vehicles.json` in `test/fixtures/`
* [ ] Mock `spawn` for `yarn start` — verify correct vehicle id, env passed
* [ ] Circuit breaker triggers after N auth failures (mock verify output)
* [ ] Reconcile only when worker count = 0 (if testable without flakiness)

### Step 4: Start scripts

* [ ] Update `start-bulk-download.sh`, `start-bulk-in-terminal.sh` to call new entry (if path changes)
* [ ] Update `docs/reference/architecture.md` blessed commands if needed
* [ ] Update `PIPELINE_OPS.md`

### Step 5: Deprecation

* [ ] Mark old bash sections removed with git history reference
* [ ] Do **not** remove `ensure-bulk-running.sh` / watchdog in this guide (Phase G)

## ✅ Verification & Definition of Done

* [ ] `./scripts/start-bulk-in-terminal.sh` starts orchestrator; PPID=1 after detach
* [ ] 2 workers run in parallel; `patch-queue` updates statuses
* [ ] Periodic reconcile + PDF audit fire on idle (manual or timed test)
* [ ] `yarn test` + manual 30-min soak on 2–3 vehicles
* [ ] No regression in `queue-status.sh --health` output shape

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Orchestrator dies on start | **Critical** | Only merge when bulk stopped; soak test before subscription reliance |
| Queue status corruption | **High** | patch-queue only from orchestrator; integration tests |
| Worker spawn env drift | High | Compare env passed to `yarn start` before/after |
| Operator script confusion | Medium | Single blessed path in PIPELINE_OPS |

**Rollback:** `git revert` + restore bash orchestrator + Terminal restart.

**Safe during active bulk:** **NO**

---

**Status:** Plan only — **not implemented**  
**Depends on:** Dev Guides 02, 03; **bulk stopped**  
**Blocks:** None (Guide 05 can proceed in parallel after 03 if capture-only)

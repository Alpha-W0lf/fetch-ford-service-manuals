# Dev Guide 04.1: Orchestrator Reliability (RUN-01 Stall Fix)

## 🎯 Objective

Make the bulk orchestrator **self-recovering** under parallel workers by removing the blocking post-worker CDP prune from the hot path and adding PID-aware stale-worker reaping — without changing fleet download behavior.

## 📚 Critical Context & References

> **CRITICAL:** Read before implementation.

* **Root cause investigation:** [../2026-07-09_bulk_stall_root_cause_investigation.md](../2026-07-09_bulk_stall_root_cause_investigation.md) (RUN-01)
* **Issue registry:** [../known_issues_and_backlog.md](../known_issues_and_backlog.md) — RUN-01, RUN-02
* **Parent guide (executed):** [2026-07-08_dev_guide_04_orchestrator_split.md](./2026-07-08_dev_guide_04_orchestrator_split.md) — **do not reopen**; this guide is the follow-up logical unit
* **Architecture:** `docs/reference/architecture.md`, `docs/reference/cdp_tab_hygiene.md`
* **Orchestrator:** `lib/bulk-orchestrator-lib.js`, `scripts/bulk-orchestrator.js`
* **Worker prune (keep):** `src/index.ts` line ~270 — `await pruneOrphanCdpTabs()` after wiring
* **Shutdown prune (keep):** `scripts/bulk-download.sh` `cleanup` trap — fire-and-forget on exit only
* **Tests baseline:** `test/bulk-orchestrator.test.ts` (9 tests; **68** total)
* **Agent:** `AGENTS.md` — smallest correct change; bulk **stopped** for implementation
* **Execution workflow:** `second_brain/docs/guides/prompt_follow_dev_guide.md`

**Gate:** Bulk **stopped** (stalled or deliberate stop) + `yarn test` green before start.

**Why not append to Guide 04?** Guide 04 is **executed** and scoped to bash→Node parity split. RUN-01 is a distinct reliability gap found in live soak. Per `meta_creating_dev_guides.md`, one logical unit per guide.

---

## 🏗️ Architectural Pattern

> **Pattern:** Non-blocking worker lifecycle + PID-aware reap  
> **Flow:** `spawn yarn` → track `pid` → `await close` → disk verify → `markStatus` — **no orchestrator prune in between**  
> **Constraint:** Never `spawnSync` CDP/Playwright work on the orchestrator hot path while `PARALLEL > 1`.

### Root cause (verified)

```
runOne(A) finishes yarn → spawnSync(prune) BLOCKS Node event loop
  → worker B close handler never runs
  → inFlight stuck (done=false) × PARALLEL
  → startWorkers blocked; reapWorkers ineffective
```

### Target flow (after fix)

```
orchestratorTick
  → reapStaleWorkers()     # dead pid → fixOrphanDownloading, free slot
  → reapWorkers()          # done=true entries
  → startWorkers()         # dispatch if slots free

runOne
  → spawnYarnStart (track pid + manual resolve hook for stale reap)
  → await yarn exit
  → disk verify + markStatus
  → (no orchestrator prune)
```

### Prune responsibility matrix (after fix)

| Caller | When | Keep? |
|--------|------|-------|
| `src/index.ts` | End of each `yarn start` wiring phase | **Yes** — worker-owned, async |
| `bulk-orchestrator-lib.js` `runOne` | After each worker | **Remove** — caused RUN-01 |
| `bulk-download.sh` `cleanup` trap | Orchestrator exit | **Yes** — shutdown hygiene only |

---

## Design decisions (resolved — do not re-debate in implementation)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Remove vs async orchestrator prune? | **Remove** from `runOne` | Worker already prunes; duplicate caused CDP dogpile + blocking |
| PID tracking? | **Yes** — `entry.pid` + `entry._resolveWorker` | Enables stale reap when `close` never fires |
| `spawnSync` elsewhere in orchestrator? | **Keep** for reconcile/preflight/cookies — idle or startup only | Not on parallel worker completion path |
| New env flag to re-enable orchestrator prune? | **No** | Simplicity; worker + shutdown trap sufficient |
| `browser.close()` timeout in `pruneOrphanCdpTabs`? | **Yes** — Step 4 optional hardening | Prevents worker-side prune hangs (RUN-02); bounded `finally` |

---

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [ ] Bulk **stopped** — kill hung prune children if orchestrator frozen (see investigation doc)
* [ ] `node scripts/reconcile-queue.js` — fix orphaned `downloading` rows on disk
* [ ] `yarn test` green (68 baseline)
* [ ] Read investigation doc + this guide end-to-end

### Step 1: Remove blocking prune from `runOne` (primary fix)

* [ ] Delete `pruneCdpTabs(config, deps)` call from `runOne()` after `spawnYarnStart` (~line 398)
* [ ] **Keep** `pruneCdpTabs` function for now OR delete if unused — grep confirms only `runOne` + tests
* [ ] Add one-line orchestrator log if useful: `[prune] skipped in orchestrator (worker prunes in index.ts)`
* [ ] **Do not** remove worker prune in `src/index.ts` or shutdown trap in `bulk-download.sh`

### Step 2: PID-aware `inFlight` entries

* [ ] Extend `inFlight` entry shape:

```javascript
// { vid, done, exitCode, pid, _resolveWorker }
```

* [ ] Refactor `spawnYarnStart` to accept `entry` (or callback object):
  * Set `entry.pid = child.pid` on spawn
  * Store `entry._resolveWorker = finish` where `finish(code)` resolves promise once (idempotent)
  * `child.on('close', …)` and `child.on('error', …)` call `finish`
* [ ] Update `startWorkers` to pass `entry` into `runOne(config, job, deps, state, entry)`

### Step 3: `reapStaleWorkers` (belt-and-suspenders)

* [ ] Add `lib/process-alive.js`:

```javascript
function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
```

* [ ] Add `reapStaleWorkers(config, state, deps)`:
  * For each `inFlight` entry where `!done && pid && !isProcessAlive(pid)`:
    * `fixOrphanDownloading(config, entry.vid, 1, deps)` — disk-truth queue patch
    * `entry.exitCode = 1`; `entry.done = true`
    * `entry._resolveWorker?.(1)` — unblock zombie `runOne` promise if waiting
    * Log: `[reap-stale] ${vid} worker pid ${pid} dead — slot freed`
* [ ] Call `reapStaleWorkers` at **start** of `orchestratorTick`, before `reapWorkers`
* [ ] Export for tests

### Step 4: Harden `pruneOrphanCdpTabs` shutdown (optional, same PR)

* [ ] In `src/cdpConnectorPage.ts` `finally` block — wrap `cdpBrowser?.close()` in `Promise.race` with **10s** timeout (constant or `CDP_DISCONNECT_TIMEOUT_MS` env default 10000)
* [ ] On timeout: log warn, continue — do not throw
* [ ] Prevents worker/shutdown prune subprocess hangs (RUN-02)

### Step 5: Tests

* [ ] `test/process-alive.test.ts` — `isProcessAlive` for current pid vs bogus pid
* [ ] `test/bulk-orchestrator.test.ts` additions:
  * **stale worker reap:** mock spawn with pid; kill pid simulation via `isProcessAlive` mock; assert `inFlight` cleared and queue patched
  * **parallel completion:** two `runOne` with delayed yarn close — assert both complete without `spawnSync` prune mock blocking event loop
  * **runOne no longer calls prune spawnSync:** assert `spawnSync` not invoked with `prune-cdp-tabs` in args during `runOne`
* [ ] `yarn test` green — baseline 68 + new tests

### Step 6: Docs

* [ ] `docs/reference/architecture.md` — orchestrator worker lifecycle paragraph (no post-worker prune)
* [ ] `docs/reference/env_vars.md` — `CDP_DISCONNECT_TIMEOUT_MS` if Step 4 added
* [ ] `docs/known_issues_and_backlog.md` — mark RUN-01 fix **planned → executed** after soak
* [ ] `docs/2026-07-09_bulk_stall_root_cause_investigation.md` — link to this guide; status → fix planned
* [ ] Guide 04 — add "Follow-up" pointer only (do not uncheck executed items)

### Step 7: Verification (operator)

* [ ] Restart bulk: `./scripts/start-bulk-in-terminal.sh` (Terminal.app only)
* [ ] `PARALLEL=2` — two workers complete; orchestrator log shows OK/INCOMPLETE/FAIL lines (not stuck at START)
* [ ] Simulate stale worker: optional — kill one `yarn start` mid-job; within one `orchestratorTick` (~5s) slot frees and new worker dispatches
* [ ] Capture may continue in parallel — no regression
* [ ] 30+ min soak with connector-heavy vehicle — no orchestrator freeze

---

## ✅ Verification & Definition of Done

* [ ] No `spawnSync(prune)` on `runOne` completion path
* [ ] `reapStaleWorkers` unit tested — dead pid frees slot + patches queue
* [ ] Parallel workers complete independently (no event-loop block on worker A blocking B)
* [ ] `yarn test` green
* [ ] Live restart: bulk dispatches after prior stall; queue `downloading` rows cleared
* [ ] Worker prune in `index.ts` unchanged; shutdown trap unchanged

---

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| CDP tab accumulation without orchestrator prune | Low | Worker prunes per job; shutdown trap prunes on exit; monitor tab count |
| Stale reap marks wrong status | Medium | Use `fixOrphanDownloading` + disk verify (existing Guide 04 logic) |
| Double `markStatus` if zombie `runOne` completes after stale reap | Medium | `finish()` idempotent; `runOne` checks `entry.done` before final `markStatus` OR skip mark if queue no longer `downloading` |
| Removing prune exposes different CDP bug | Low | Worker-side prune still runs; Step 4 bounds disconnect |
| Regression in Guide 04 soak behaviors | Medium | Do not change spawn args, circuit breaker, cookie refresh |

**Rollback:** `git revert`; restart bulk from Terminal.app.

**Safe during active bulk:** **NO** (implementation gate).

**Safe during active capture:** **Yes** — capture is separate process; restart bulk after deploy.

---

## Strangler order (mandatory)

1. Tests first for `isProcessAlive` + `reapStaleWorkers` (red)
2. Remove `pruneCdpTabs` from `runOne`
3. PID tracking in `spawnYarnStart` + `entry` passthrough
4. Implement `reapStaleWorkers` + wire into `orchestratorTick`
5. Green tests
6. Optional Step 4 (`cdpConnectorPage` disconnect timeout)
7. Docs + operator soak

---

## Out of scope (defer)

* Orchestrator heartbeat logging (P2 — Phase G)
* Consolidating triple prune into single service
* Splitting `bulk-orchestrator-lib.js` (~668 lines) — separate optional guide
* `maybePeriodicMaintenance` while `inFlight` has only dead PIDs — addressed by `reapStaleWorkers` instead

---

**Status:** **Implementation-ready** (2026-07-09)  
**Depends on:** Dev Guide 04 (**executed**), investigation doc  
**Blocks:** None — Guide 05 capture modularization is independent

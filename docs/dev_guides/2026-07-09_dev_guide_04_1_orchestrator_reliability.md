# Dev Guide 04.1: Orchestrator Reliability (RUN-01 Stall Fix)

## 🎯 Objective

Make the bulk orchestrator **self-recovering** under parallel workers by removing the blocking post-worker CDP prune from the hot path and adding PID-aware stale-worker reaping — without changing fleet download behavior.

## 📚 Critical Context & References

> **CRITICAL:** Read before implementation.

* **Root cause investigation:** [../2026-07-09_bulk_stall_root_cause_investigation.md](../2026-07-09_bulk_stall_root_cause_investigation.md) (RUN-01)
* **Issue registry:** [../known_issues_and_backlog.md](../known_issues_and_backlog.md) — RUN-01, RUN-02
* **Parent guide (executed):** [2026-07-08_dev_guide_04_orchestrator_split.md](./2026-07-08_dev_guide_04_orchestrator_split.md) — **do not reopen**; follow-up logical unit only
* **Architecture:** `docs/reference/architecture.md`, `docs/reference/cdp_tab_hygiene.md`, `docs/reference/queue_state_machine.md`
* **Orchestrator:** `lib/bulk-orchestrator-lib.js` (668 lines), `scripts/bulk-orchestrator.js`
* **Disk verify:** `lib/bulk-download-status.js` — `resolveDownloadStatus`, `verifyDownloadOk`
* **Worker prune (keep):** `src/index.ts` ~line 270 — `await pruneOrphanCdpTabs()` after wiring
* **Shutdown prune (keep):** `scripts/bulk-download.sh` `cleanup` trap line 60 — on exit only
* **Tests:** `test/bulk-orchestrator.test.ts` (9 tests); **68** total (`yarn test` verified 2026-07-09)
* **Agent:** `AGENTS.md` — smallest correct change; bulk **stopped** for implementation
* **Ops:** `docs/PIPELINE_OPS.md` — Terminal.app start path
* **Execution workflow:** `second_brain/docs/guides/prompt_follow_dev_guide.md`

**Gate:** Bulk **stopped** (stalled or deliberate stop) + `yarn test` green + `node scripts/reconcile-queue.js` once.

**Why not append to Guide 04?** Guide 04 is **executed** (bash→Node parity). RUN-01 is a distinct reliability gap. Per `meta_creating_dev_guides.md`: one logical unit per guide.

---

## 🏗️ Architectural Pattern

> **Pattern:** Non-blocking worker lifecycle + disk-truth stale reap  
> **Flow:** `spawn yarn` → track `pid` → `await close` → disk verify → `markStatus` — **no orchestrator prune**  
> **Constraint:** Never `spawnSync` CDP/Playwright on the parallel worker completion path.

### Root cause (verified RUN-01)

```
runOne(A) finishes yarn → spawnSync(prune) BLOCKS Node event loop
  → worker B close handler never runs
  → inFlight stuck (done=false) × PARALLEL
  → startWorkers blocked; reapWorkers ineffective (requires done=true)
```

### Target flow

```
orchestratorTick / waitForInFlight
  → reapStaleWorkers()     # dead pid → patch queue from disk, free slot
  → reapWorkers()          # remove done=true entries, count failures

runOne
  → spawnYarnStart(entry)  # track pid + _resolveWorker
  → if entry.reaped → return (queue already patched)
  → disk verify + markStatus
```

### Prune responsibility matrix (after fix)

| Caller | When | Action |
|--------|------|--------|
| `src/index.ts` | End of each `yarn start` wiring | **Keep** — async worker prune |
| `bulk-orchestrator-lib.js` `runOne` | After each worker | **Delete** — caused RUN-01 |
| `bulk-download.sh` `cleanup` trap | Orchestrator exit | **Keep** — shutdown only |

### Code map (verified line numbers 2026-07-09)

| Symbol | File:lines | Change |
|--------|------------|--------|
| `pruneCdpTabs` | `bulk-orchestrator-lib.js:287-300` | **Delete** function + call at :398 |
| `spawnYarnStart` | `:306-325` | Add `entry` param; pid + `_resolveWorker` |
| `runOne` | `:331-435` | Add `entry` param; remove prune; `reaped` guard |
| `reapWorkers` | `:461-474` | Unchanged |
| `startWorkers` | `:490-516` | Pass `entry` to `runOne` |
| `orchestratorTick` | `:563-605` | Call `reapStaleWorkers` first |
| `waitForInFlight` | `:437-449` | Call `reapStaleWorkers` in wait loop |
| `module.exports` | `:652-668` | Export `reapStaleWorkers`, `patchStaleWorkerFromDisk` |

---

## Design decisions (resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Remove vs async orchestrator prune? | **Remove** | Worker already prunes; duplicate caused CDP dogpile + blocking |
| Stale reap status source? | **Disk truth** via `resolveDownloadStatus` | `yarn start` exits **0** even with gaps (`index.ts:375`); hardcoding `exitCode=1` would mark `incomplete` as `failed` |
| PID tracking? | **Yes** — `entry.pid`, `entry._resolveWorker`, `entry.reaped` | Unblock `spawnYarnStart` when stale; prevent double `markStatus` |
| Delete `pruneCdpTabs` function? | **Yes** | Only caller is `runOne` (:398); not exported |
| `spawnSync` elsewhere? | **Keep** | reconcile/preflight/cookies — startup/idle only |
| `browser.close()` timeout in prune? | **Yes — in scope** (Step 4) | RUN-02 hung prunes 33min+; bounds worker/shutdown prune |
| New env flag for orchestrator prune? | **No** | Simplicity |

### Stale reap status mapping (critical — do not use `fixOrphanDownloading` with `exitCode=1` blindly)

`yarn start` exits `0` when gaps exist but logs "Capture incomplete". `resolveFinalVehicleStatus(1, 'incomplete')` → **`failed`** (wrong).

Add **`patchStaleWorkerFromDisk(config, vehicleId, deps)`**:

```javascript
// Pseudocode — map disk only, no yarn exit code
const meta = readVehicleQueueStatus(config.queuePath, vehicleId);
const disk = resolveDownloadStatus(config.root, meta.v.outputDir, meta.workshop, meta.wiring);
const status = disk === "complete" ? "complete" : disk === "incomplete" ? "incomplete" : "failed";
patchVehicleStatus(config.queuePath, vehicleId, status);
return { status, exitCode: status === "complete" ? 0 : 1 };
```

Use this from `reapStaleWorkers`, not `fixOrphanDownloading(..., 1, ...)`.

---

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [ ] Bulk **stopped** — if frozen (RUN-01): kill orchestrator's prune child (`pgrep -P <orchestrator-pid>`), then stop orchestrator (Ctrl+C in bulk Terminal or `kill <pid>`)
* [ ] `pkill -f 'prune-cdp-tabs'` only if needed — **capture may be running**; prefer killing PPID-specific children first
* [ ] `node scripts/reconcile-queue.js` — fix orphaned `downloading` on disk
* [ ] `yarn test` green (**68** baseline)
* [ ] Read investigation doc + this guide end-to-end

### Step 1: Remove blocking prune (primary fix — can ship alone for stall relief)

* [ ] Delete `pruneCdpTabs(config, deps)` call at `runOne` line **398**
* [ ] Delete entire `pruneCdpTabs` function (lines **287-300**) — no remaining callers
* [ ] **Do not** remove worker prune (`src/index.ts`) or shutdown trap (`bulk-download.sh:60`)

### Step 2: `lib/process-alive.js` + exports

* [ ] Create `lib/process-alive.js`:

```javascript
function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
module.exports = { isProcessAlive };
```

* [ ] `test/process-alive.test.ts` — current pid alive; `999999999` dead

### Step 3: PID-aware `spawnYarnStart` + `runOne` entry

* [ ] `inFlight` entry shape: `{ vid, done, exitCode, pid, reaped, _resolveWorker }`
* [ ] `spawnYarnStart(config, yarnArgs, logPath, entry, deps)`:
  * `let settled = false`; `finish(code)` idempotent resolve
  * `entry.pid = child.pid`; `entry._resolveWorker = finish`
  * `child.on('close'|'error')` → `finish`
* [ ] `runOne(config, job, deps, orchestratorState, entry)` — **5th param optional** for tests
* [ ] After `await spawnYarnStart(...)`: `if (entry?.reaped) return entry.exitCode ?? 1;`
* [ ] `startWorkers`: pass `entry` into `runOne(config, job, deps, state, entry)`

### Step 4: `patchStaleWorkerFromDisk` + `reapStaleWorkers`

* [ ] `patchStaleWorkerFromDisk(config, vehicleId, deps)` — disk-truth mapping (see Design decisions)
* [ ] `reapStaleWorkers(config, state, deps)`:
  * For each `inFlight` where `!done && pid && !isProcessAlive(pid)`:
    * `{ status, exitCode } = patchStaleWorkerFromDisk(...)` (only if queue still `downloading`)
    * `entry.reaped = true`; `entry.done = true`; `entry.exitCode = exitCode`
    * `entry._resolveWorker?.(exitCode)`
    * Log: `[reap-stale] ${vid} pid ${pid} dead → ${status}`
* [ ] Wire into **`orchestratorTick`** (before `reapWorkers`) **and** **`waitForInFlight`** wait loop
* [ ] Export from `module.exports`

### Step 5: Harden `pruneOrphanCdpTabs` disconnect (RUN-02 — same PR)

* [ ] `src/cdpConnectorPage.ts` `finally`: wrap `cdpBrowser?.close()` in `Promise.race` with **10s** timeout
* [ ] Constant `CDP_DISCONNECT_TIMEOUT_MS` env default **10000** (document in `env_vars.md`)
* [ ] On timeout: `console.warn`, continue — never throw
* [ ] Optional: same pattern for `createConnectorPage` `close()` path if needed (out of scope unless hang reproduces)

### Step 6: Tests (`test/bulk-orchestrator.test.ts`)

* [ ] **stale reap:** entry with dead pid mock → queue patched `incomplete` from disk gaps (not `failed`)
* [ ] **stale reap:** disk complete → queue `complete`
* [ ] **reaped guard:** `runOne` after `_resolveWorker` + `reaped` does not double-`markStatus`
* [ ] **no prune spawnSync:** `runOne` never calls `spawnSync` with `prune-cdp-tabs` in args
* [ ] **parallel:** two mocked yarn children complete without blocking (no prune in deps)
* [ ] Update `runOne` test if signature changes (5th param optional — existing test still passes)
* [ ] `yarn test` green — expect **73+** tests (68 + ~5 new)

### Step 7: Docs

* [ ] `docs/reference/architecture.md` — worker lifecycle: no post-worker orchestrator prune; stale reap
* [ ] `docs/reference/env_vars.md` — `CDP_DISCONNECT_TIMEOUT_MS`
* [ ] `docs/PIPELINE_OPS.md` — stall symptoms + recovery one-liner → investigation doc
* [ ] After soak: `known_issues_and_backlog.md` RUN-01 → executed

### Step 8: Operator verification

* [ ] `./scripts/start-bulk-in-terminal.sh` (Terminal.app only)
* [ ] `PARALLEL=2` — orchestrator logs OK/INCOMPLETE/FAIL after each START (not stuck)
* [ ] Optional: `kill -9` one `yarn start` mid-job → slot frees within ~5s (`orchestratorTick` sleep)
* [ ] Capture may run in parallel — no regression
* [ ] 30+ min connector-heavy soak — no freeze

---

## ✅ Verification & Definition of Done

* [ ] No `pruneCdpTabs` in codebase (grep clean)
* [ ] `reapStaleWorkers` + `patchStaleWorkerFromDisk` unit tested
* [ ] Stale incomplete disk → queue `incomplete` (not `failed`)
* [ ] `waitForInFlight` calls `reapStaleWorkers` (shutdown path)
* [ ] `yarn test` green
* [ ] Live restart after RUN-01 stall dispatches workers
* [ ] Worker + shutdown prune unchanged

---

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| CDP tab accumulation without orchestrator prune | Low | Worker prunes per job; shutdown trap; monitor Chrome tabs |
| Stale reap wrong status | **High** if exitCode=1 used | **Disk-truth** `patchStaleWorkerFromDisk` (documented above) |
| Double `markStatus` after stale reap | Medium | `entry.reaped` guard in `runOne` |
| Zombie `runOne` after reap | Low | `_resolveWorker` idempotent; early return if `reaped` |
| Removing prune exposes CDP bug | Low | Step 5 bounds disconnect; worker prune retained |
| Guide 04 regression (spawn args, circuit breaker) | Medium | Do not touch cookie/circuit/spawn flags |
| `pkill prune` kills capture-related process | Low | Prefer `pgrep -P <orchestrator-pid>` over global pkill |

**Rollback:** `git revert`; `node scripts/reconcile-queue.js`; `./scripts/start-bulk-in-terminal.sh`.

**Safe during active bulk:** **NO** (implementation).

**Safe during active capture:** **Yes** — restart bulk after deploy; capture independent.

---

## Strangler order (mandatory)

1. `lib/process-alive.js` + tests
2. **Remove** `pruneCdpTabs` (immediate stall fix if deployed alone)
3. `patchStaleWorkerFromDisk` + `reapStaleWorkers` + tests (red → green)
4. PID tracking in `spawnYarnStart` + `reaped` guard
5. Wire `reapStaleWorkers` into `orchestratorTick` + `waitForInFlight`
6. Step 5 `cdpConnectorPage` disconnect timeout
7. Docs + operator soak

---

## Out of scope

* Orchestrator heartbeat (P2 / Phase G)
* Single prune service abstraction
* Split `bulk-orchestrator-lib.js` size
* Changing `yarn start` to exit non-zero on gaps

---

**Status:** **Implementation-ready** (pass 2 — 2026-07-09)  
**Depends on:** Guide 04 executed, investigation doc  
**Blocks:** None (Guide 05 independent)

# Dev Guide 04.2: Unsupervised Pipeline Reliability

## 🎯 Objective

Make bulk (and companion capture) **self-healing without manual intervention** for **4–12+ hour** runs: bound hung-**alive** workers, emit orchestrator heartbeats, reap orphan prune processes, release capture CDP handles on exit, and extend the watchdog to detect external stall — building on Guide 04.1.

## 📚 Critical Context & References

> **CRITICAL:** Read before implementation.

* **Session checkpoint:** [../2026-07-09_pipeline_session_checkpoint.md](../2026-07-09_pipeline_session_checkpoint.md) — REL gaps, 2016 TCM episode, soak evidence
* **Parent guide (executed):** [2026-07-09_dev_guide_04_1_orchestrator_reliability.md](./2026-07-09_dev_guide_04_1_orchestrator_reliability.md) — `reapStaleWorkers`, `patchStaleWorkerFromDisk`, PID tracking
* **Issue registry:** [../known_issues_and_backlog.md](../known_issues_and_backlog.md) — REL-01 through REL-07
* **Orchestrator:** `lib/bulk-orchestrator-lib.js` (**728** lines post-04.1), `lib/process-alive.js`
* **Capture:** `scripts/capture-params.ts` — CDP `closeOnDone: false` leaves Playwright handles open (REL-02)
* **Watchdog:** `scripts/ensure-bulk-running.sh` (experimental companion to `install-bulk-watchdog.sh`)
* **Tests:** `test/bulk-orchestrator.test.ts` (14 tests); **75** total baseline (`yarn test`)
* **Agent:** `AGENTS.md` — smallest correct change; bulk **stopped** for implementation
* **Ops:** `docs/PIPELINE_OPS.md`
* **Execution workflow:** `second_brain/docs/guides/prompt_follow_dev_guide.md`

**Gate:** Bulk **stopped** + `yarn test` green + read 04.1 guide + checkpoint doc.

**Why not append to Guide 04.1?** 04.1 fixed RUN-01 (dead-PID + blocking prune). 04.2 addresses **alive-but-stuck** workers and **companion-process** hygiene — distinct logical unit per `meta_creating_dev_guides.md`.

---

## Scope tiers (read this first)

### Tier A — In scope (04.2 core — orchestrator)

| ID | Deliverable |
|----|-------------|
| REL-01 / REL-06 | `reapHungWorkers` — log-stale + wall-clock max runtime |
| REL-05 | Orchestrator heartbeat each tick |
| REL-03 | Orphan `prune-cdp-tabs` process reaper |

### Tier B — In scope (same PR — companion processes)

| ID | Deliverable | Why in 04.2 |
|----|-------------|-------------|
| REL-02 | Capture CDP disconnect on session end | Zombie capture holds CDP handles; blocks unsupervised bulk+capture; **~15 lines**, no Guide 05 dependency |
| REL-04 (partial) | `ensure-bulk-running.sh` **stall detection** | External recovery when orchestrator process alive but throughput zero — complements internal hung reap |

### Tier C — Explicitly out of scope (separate guides / product)

| Item | Why **not** 04.2 |
|------|------------------|
| **E-Transit / PTS catalog gaps** | **Feature/data problem** (RUN-06) — PTS menu lacks model; no timeout or kill logic fixes it. → Guide 07 or queue `skip` policy |
| **`yarn start` exit codes on gaps** | **Fleet-wide contract change** (`index.ts:375` always `exit 0`); affects `fixOrphanDownloading`, tests, operator semantics. 04.2 uses **disk-truth** (`patchStaleWorkerFromDisk`) and does **not** need this. → Optional future guide if contract cleanup desired |
| **launchd install + FDA/TCC proof** | **Platform ops** (OPS-02/03) — different blast radius, unproven on `~/Documents`. Stall **detection** script enhancement is Tier B; **installing** watchdog is Phase G |
| **Guide 05 capture modularization** | Large refactor; REL-02 fix is minimal disconnect only |
| **Guide 06 pre-2003** | Feature exploration |

---

## 🏗️ Architectural Pattern

> **Pattern:** Layered reap pipeline + bounded worker lifetime  
> **Flow:** `reapHungWorkers` → `reapStaleWorkers` → `reapWorkers` → heartbeat → maintenance  
> **Constraint:** Forced kills **always** patch queue via `patchStaleWorkerFromDisk` — never blind `exitCode=1`.

### Target tick flow

```
orchestratorTick / waitForInFlight
  → reapHungWorkers()      # alive+log-stale OR wall-clock → kill → disk patch
  → reapStaleWorkers()     # dead pid (04.1)
  → reapWorkers()          # done=true cleanup
  → maybeReapOrphanPrunes()  # kill stale prune-cdp-tabs not owned by live tree
  → maybeRefreshCookies / startWorkers / …
  → logHeartbeat()         # when inFlight non-empty (end of tick)
```

### Incident archetype (REL-01 — 2016-f-250 TCM)

```
Worker pid ALIVE, log mtime frozen 9+ min, CPU ~99%
  → reapStaleWorkers: skip (isProcessAlive true)
  → slot blocked until lucky completion OR manual kill
04.2 fix:
  → reapHungWorkers: log mtime > WORKER_LOG_STALE_MS → forceKillWorker → patchStaleWorkerFromDisk
```

### Code map (verified 2026-07-09 post-04.1)

| Symbol | File:lines | Change |
|--------|------------|--------|
| `reapStaleWorkers` | `bulk-orchestrator-lib.js:315-331` | Unchanged; runs **after** hung reap |
| `patchStaleWorkerFromDisk` | `:288-313` | Reuse for hung kill path |
| `startWorkers` entry | `:553-570` | Add `startedAt`, `logPath` |
| `orchestratorTick` | `:620-655` | Wire hung reap + heartbeat + orphan prune |
| `waitForInFlight` | `:485-499` | Wire `reapHungWorkers` before stale reap |
| `loadConfig` | `:38-87` | New env-backed timeouts |
| `capture-params.ts` main end | `:745-757` | CDP disconnect (REL-02) |
| `ensure-bulk-running.sh` | full file | Stall detection (REL-04 partial) |

---

## Design decisions (resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Hung vs stale reap order? | **Hung first**, then stale (dead PID) | Kill stuck-alive before checking death |
| Kill signal? | **SIGTERM**, wait `WORKER_KILL_GRACE_MS` (5s), then **SIGKILL** | Allow graceful yarn/ts-node shutdown |
| Which PID to kill? | `entry.pid` (yarn child from 04.1) | Killing yarn tree is sufficient on macOS |
| Status on forced kill? | **`patchStaleWorkerFromDisk` only** | Same contract as 04.1 — incomplete disk ≠ failed |
| Log stale detection? | `fs.statSync(logPath).mtimeMs` when `entry.pid` set | `spawnYarnStart` truncates `logs/${vid}.log` when pid assigned — do **not** use stale mtime before pid exists |
| Pre-spawn hang (`!entry.pid`)? | **Wall-clock only** (`WORKER_MAX_RUNTIME_MS` vs `startedAt`) | `runOne` can block on cookie refresh before `spawnYarnStart`; log-stale skipped without pid |
| Missing log file? | `getVehicleLogMtime` returns `null` → treat as fresh (no log-stale kill) | ENOENT before first write |
| Wall clock? | `entry.startedAt` in `runOne` **after** `markStatus(..., downloading)` | Excludes fast pre-mark path; aligns wall clock with queue `downloading` so `patchStaleWorkerFromDisk` succeeds |
| Default `WORKER_LOG_STALE_MS`? | **20 min** (1200000) | 2016 TCM froze ~9 min then recovered — **15 min risks false kill** on slow connector saves; 20 min bounds slot waste while tolerating PTS pauses |
| Default `WORKER_MAX_RUNTIME_MS`? | **4 h** (14400000) | Connector-heavy jobs can run long; tunable |
| Heartbeat frequency? | Every `orchestratorTick` when `inFlight.length > 0` | ~5s during active workers |
| Orphan prune reaper? | Kill `prune-cdp-tabs` PIDs with etime > `PRUNE_ORPHAN_MAX_AGE_MIN` (30) **not** under orchestrator/worker tree | Addresses RUN-02 residual without killing active prunes |
| Capture CDP exit? | `await browser.close()` when `connectedViaCdp` — **disconnect Playwright, keep PTS Chrome** | Playwright CDP `close()` releases handles; Node can exit. Verify in Step 6. |
| Watchdog scope? | Enhance **detection** in `ensure-bulk-running.sh`; do **not** require launchd install in this PR | OPS-02 proof is Phase G |

### Env vars (add to `docs/reference/env_vars.md`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `WORKER_LOG_STALE_MS` | `1200000` | Kill alive worker if vehicle log mtime older than this |
| `WORKER_MAX_RUNTIME_MS` | `14400000` | Kill worker after wall-clock runtime |
| `WORKER_KILL_GRACE_MS` | `5000` | Wait after SIGTERM before SIGKILL |
| `PRUNE_ORPHAN_MAX_AGE_MIN` | `30` | Reap prune processes older than this (minutes) |
| `WATCHDOG_STALL_WORKERS_MIN` | `20` | Minutes; stall threshold for 0 workers + `downloading` stuck — **same 20 min wall-clock as log-stale default** (not ms; do not compare to `WORKER_LOG_STALE_MS` numerically) |

Set any to `0` to disable that check (except kill grace).

---

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [ ] Bulk **stopped**
* [ ] `yarn test` green (**75** baseline)
* [ ] Read checkpoint + 04.1 guide
* [ ] `node scripts/reconcile-queue.js`

### Step 1: Config + entry shape

* [ ] Extend `loadConfig` with timeout fields (env defaults above)
* [ ] Extend `inFlight` entry at `startWorkers`: `{ …, startedAt: null, logPath: path.join(config.logDir, \`${vid}.log\`) }`
* [ ] In `runOne`, after `markStatus(config, vid, "downloading")`: `if (entry) entry.startedAt = Date.now()`
* [ ] Export `getVehicleLogMtime(logPath, deps)` helper (injectable `statSync` for tests)

### Step 2: `forceKillWorker(entry, deps)` + `reapHungWorkers`

* [ ] `forceKillWorker(config, entry, deps)`:
  * if `!entry.pid` return (no process to signal)
  * `process.kill(entry.pid, 'SIGTERM')` (catch ESRCH)
  * `await deps.sleep(config.workerKillGraceMs)`
  * if still alive: `process.kill(entry.pid, 'SIGKILL')`
* [ ] `reapHungWorkers(config, state, deps)`:
  * Skip if `entry.done`
  * Skip hung checks entirely if `WORKER_LOG_STALE_MS === 0 && WORKER_MAX_RUNTIME_MS === 0`
  * `runtimeExceeded = entry.startedAt != null && WORKER_MAX_RUNTIME_MS > 0 && (now - entry.startedAt) > WORKER_MAX_RUNTIME_MS` — applies when `!entry.pid` (pre-spawn `runOne` hang after queue is `downloading`)
  * `logStale` only when `entry.pid` set: `WORKER_LOG_STALE_MS > 0 && mtime != null && (now - mtime) > WORKER_LOG_STALE_MS`
  * If `logStale || runtimeExceeded`: `forceKillWorker` (no-op kill if `!entry.pid` — still patch + free slot) → `patchStaleWorkerFromDisk` → mirror 04.1 stale path: `entry.reaped = true`, `entry.done = true`, `entry.exitCode`, `entry._resolveWorker?.(exitCode)` (runOne already skips post-kill status at `:446` when `reaped`)
  * Log: `[reap-hung] ${vid} pid ${pid} → ${reason} → ${status}`
  * `reapHungWorkers` is **async** (`await forceKillWorker`); `orchestratorTick` / `waitForInFlight` must **`await reapHungWorkers`**

### Step 3: Wire reap order + `runOne` reaped guards

* [ ] `orchestratorTick`: `await reapHungWorkers` → `reapStaleWorkers` → `await reapWorkers` → …
* [ ] `waitForInFlight`: same order in loop + final pass
* [ ] **`runOne` reaped guards** (prevents duplicate yarn after pre-spawn hung reap):
  * After `await refreshCookies(...)`: `if (entry?.reaped) return entry.exitCode ?? 1`
  * Existing after `spawnYarnStart`: `if (entry?.reaped) return entry.exitCode ?? 1` (`:446`)
* [ ] Export `reapHungWorkers`, `forceKillWorker` from `module.exports`

### Step 4: Heartbeat (REL-05)

* [ ] `logHeartbeat(config, state, deps)` when `inFlight.length > 0`:
  * `[heartbeat] inFlight=N | vid=… pid=… age=…s logAge=…s`
* [ ] Call at end of `orchestratorTick` (after worker dispatch logic) when workers running
* [ ] Throttle: optional — only when `inFlight.length > 0` (every ~5s is acceptable)

### Step 5: Orphan prune reaper (REL-03)

* [ ] `lib/orphan-prune-reaper.js`:
  * `listOrphanPrunePids(orchestratorPid, maxAgeMin, deps)` — parse `ps` or `pgrep -lf prune-cdp-tabs`
  * Exclude PIDs that are descendants of `orchestratorPid` or current `inFlight` yarn/ts-node tree
  * `reapOrphanPrunes(config, state, deps)` — `kill -9` with log line
* [ ] Call from `orchestratorTick` in **reap phase** (with hung/stale/done reaps, before cookie refresh / dispatch)
* [ ] `test/orphan-prune-reaper.test.ts` — mock ps output

### Step 6: Capture CDP disconnect (REL-02 — Tier B)

* [ ] `scripts/capture-params.ts` after session complete (~line 745):
  * When `connectedViaCdp`: `await browser.close().catch(() => undefined)` — **disconnect Playwright**
  * Keep log: "PTS Chrome left open for bulk"
  * Ensure `main()` resolves and Node exits (verify: no open handles after close)
* [ ] Do **not** refactor capture into `src/capture/` (that's Guide 05)

### Step 7: Watchdog stall detection (REL-04 partial — Tier B)

* [ ] `scripts/ensure-bulk-running.sh`:
  * If bulk **running** (`pgrep bulk-download.sh`) but `yarn workers == 0` and queue `downloading` count > 0 (small inline `node -e` on `templates/vehicles.json`) and **latest** `logs/bulk-download-*.log` mtime age > `WATCHDOG_STALL_WORKERS_MIN` → treat as **stall** → existing Terminal restart path (pattern: `prune-logs.sh` `ls -t logs/bulk-download-*.log | head -1`)
  * Log stall reason to `logs/watchdog.log`
* [ ] Document: still requires launchd/cron/manual periodic invoke — **install proof** remains Phase G

### Step 8: Tests (`test/bulk-orchestrator.test.ts` + new files)

* [ ] **hung reap:** mock alive pid + stale log mtime → `patchStaleWorkerFromDisk` called, `incomplete` not `failed`
* [ ] **max runtime:** mock `startedAt` old → kill + patch
* [ ] **reap order:** hung before stale (stale skipped if hung already reaped)
* [ ] **heartbeat:** emits when inFlight non-empty
* [ ] **pre-spawn wall clock:** `!entry.pid` + old `startedAt` (post-`downloading`) → patch + `runOne` returns early at reaped guard (no duplicate spawn)
* [ ] `yarn test` green — expect **82+** tests

### Step 9: Docs

* [ ] `docs/reference/architecture.md` — hung reap + heartbeat + reap order
* [ ] `docs/reference/env_vars.md` — new vars
* [ ] `known_issues_and_backlog.md` — REL-01/02/03/05 → executed; REL-04 partial
* [ ] `2026-07-09_pipeline_session_checkpoint.md` — link to this guide

### Step 10: Operator verification (tiered soak)

**Merge gate (required before close-out):**

* [ ] `./scripts/start-bulk-in-terminal.sh`; `PARALLEL=2`
* [ ] Bulk log shows `[heartbeat]` lines during workers
* [ ] Simulate hung worker (optional): `kill -STOP` on yarn child → verify `[reap-hung]` within `WORKER_LOG_STALE_MS` (use lowered env for test, e.g. `WORKER_LOG_STALE_MS=120000`)
* [ ] **4h+** soak with normal fleet progress — no orchestrator freeze, no permanent slot blockage, no manual kill/restart
* [ ] Capture: re-run with few `needs_params` targets; process **exits** after completion (REL-02)

**Full acceptance (run when subscription window allows — closes REL-* in backlog):**

* [ ] **12h** unattended soak with `PARALLEL=2` on connector-heavy fleet; document bulk log path + queue delta in checkpoint

---

## ✅ Verification & Definition of Done

* [ ] `reapHungWorkers` + `forceKillWorker` tested
* [ ] Forced kill on incomplete disk → queue `incomplete` (not `failed`)
* [ ] Heartbeat visible in bulk log during active workers
* [ ] Orphan prune reaper tested (mock)
* [ ] Capture process exits after CDP session (REL-02)
* [ ] `ensure-bulk-running.sh` detects 0-worker stall pattern
* [ ] `yarn test` green
* [ ] 4h+ soak without orchestrator freeze or permanent slot blockage (12h = full REL close-out)

---

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Kill slow-but-valid connector | **High** | 20 min log stale default; tunable env; max runtime 4h backstop |
| Wrong status on kill | **High** | `patchStaleWorkerFromDisk` only — never `fixOrphanDownloading(..., 1)` |
| SIGKILL mid-write | Medium | Same as crash today; gap registry + retry |
| False positive workshop kill | Low | Workshop logs frequently; mtime updates on each PDF line |
| Orphan reaper kills active prune | **High** if wrong | Exclude orchestrator + inFlight descendant PIDs; conservative max age |
| `browser.close()` kills PTS Chrome | Medium | Verify Playwright CDP disconnect-only behavior in Step 6 |
| Watchdog restart during brief idle | Low | Require `downloading` + log stale + 0 workers together |
| Pre-spawn hung reap → duplicate yarn | **High** if missed | `startedAt` after `downloading`; `runOne` reaped guard after `refreshCookies` |
| Pre-spawn hang blocks slot (`!pid`) | Medium | Wall-clock after `downloading` mark; log-stale only after pid assigned |
| Guide 04.1 regression | Medium | Preserve reap order; extend entry shape only |

**Rollback:** `git revert`; reconcile; restart bulk from Terminal.app.

**Safe during active bulk:** **NO** (implementation).

---

## Strangler order (mandatory)

1. Config + entry shape (`startedAt`, `logPath`)
2. `forceKillWorker` + `reapHungWorkers` + tests (red → green)
3. Wire reap order in tick + waitForInFlight
4. Heartbeat
5. `orphan-prune-reaper.js` + tests
6. Capture CDP disconnect (can run with bulk stopped; capture not running)
7. `ensure-bulk-running.sh` stall detection
8. Docs + soak

---

**Status:** **Executed** (2026-07-09)  
**Depends on:** Guide 04.1 executed (`6c15180`)  
**Blocks:** None for Guide 05 (orthogonal; Guide 05 should **not** re-implement REL-02 — see Tier B note)

### Pass 2 refinements (2026-07-09)

* `WATCHDOG_STALL_WORKERS_MIN` aligned to **20 min** (was 15) — external stall detection should not fire before internal hung reap
* Explicit `reaped` mirror + `await reapHungWorkers` in tick/wait loops
* Watchdog Step 7: latest `bulk-download-*.log` + queue `downloading` count via inline node
* Soak split: **4h merge gate** vs **12h full REL close-out**

### Pass 3 refinements (2026-07-09)

* **Pre-spawn hang:** wall-clock applies when `!entry.pid`; log-stale only after `spawnYarnStart` assigns pid (avoids false kill on old `logs/${vid}.log` mtime)
* `getVehicleLogMtime`: ENOENT → `null` → fresh
* Tick order clarified: all reaps (hung → stale → done → orphan prune) **before** dispatch; heartbeat **after** dispatch
* `WATCHDOG_STALL_WORKERS_MIN` units clarified (minutes, not ms)

### Pass 4 refinements (2026-07-09)

* **`startedAt` after `markStatus(downloading)`** in `runOne` — not at `startWorkers` push (patch + wall clock align with queue state)
* **`runOne` reaped guard after `refreshCookies`** — pre-spawn hung reap must not leave async `runOne` spawning duplicate yarn
* `forceKillWorker(config, entry, deps)` — grace from `config.workerKillGraceMs`; no-op when `!entry.pid`

# Pipeline session checkpoint — 2026-07-09

**Checkpoint time:** ~00:00 local (2026-07-09)  
**Prior checkpoint:** [2026-07-08_pipeline_runtime_observations.md](./2026-07-08_pipeline_runtime_observations.md) (~22:48)  
**Issue registry:** [known_issues_and_backlog.md](./known_issues_and_backlog.md)  
**Commit:** `6c15180` — Guide 04.1 (RUN-01 fix)

---

## Executive summary

| Pipeline | Running? | Progressing? | Verdict |
|----------|----------|--------------|---------|
| **Bulk** | Yes (orchestrator pid **33628**, since **23:36**) | **Yes** — jobs completing, new dispatches, 2 workshop workers | **Healthy** post–Guide 04.1 |
| **Param capture** | Process alive (pid **29405**) | **Logically finished** — retry pass done; process idle ~2.5h+ | **Zombie** — engineering gap (REL-02) |

**Reliability bar (operator requirement):** Processes must run **unsupervised 4–12+ hours** without manual kill/restart. Guide 04.1 fixed the **orchestrator freeze** (RUN-01) but is **not sufficient** alone for that bar — see [Unsupervised reliability gaps](#unsupervised-reliability-gaps).

---

## Guide 04.1 — what shipped (2026-07-09)

**Objective:** Self-recovering bulk orchestrator under `PARALLEL=2` — remove blocking post-worker CDP prune; PID-aware stale reap from disk truth.

| Change | Location |
|--------|----------|
| Deleted `pruneCdpTabs` + `spawnSync` on worker completion path | `lib/bulk-orchestrator-lib.js` |
| `lib/process-alive.js` + tests | new |
| `patchStaleWorkerFromDisk`, `reapStaleWorkers` | `lib/bulk-orchestrator-lib.js` |
| PID tracking, `entry.reaped` guard, `_resolveWorker` | `spawnYarnStart`, `startWorkers`, `runOne` |
| Wire stale reap in `orchestratorTick` + `waitForInFlight` | `lib/bulk-orchestrator-lib.js` |
| `CDP_DISCONNECT_TIMEOUT_MS` (default 10s) on `browser.close()` | `src/cdpConnectorPage.ts` |
| Docs | `architecture.md`, `env_vars.md` |
| Tests | **75** total (+7) |

**Prune responsibility after fix:**

| Caller | Action |
|--------|--------|
| `src/index.ts` ~270 | **Keep** — async worker prune per job |
| `bulk-orchestrator-lib.js` `runOne` | **Removed** — caused RUN-01 |
| `bulk-download.sh` cleanup trap ~60 | **Keep** — shutdown only |

**Rollback:** `git revert 6c15180`; `node scripts/reconcile-queue.js`; `./scripts/start-bulk-in-terminal.sh`.

---

## RUN-01 incident → recovery → soak (verified)

### Root cause (pre-fix)

`runOne` called `spawnSync(prune-cdp-tabs)` after each `yarn start`. With `PARALLEL=2`, worker A's prune blocked the Node event loop → worker B's `close` handler never ran → `inFlight` stuck `done=false` → zero throughput. Full analysis: [2026-07-09_bulk_stall_root_cause_investigation.md](./2026-07-09_bulk_stall_root_cause_investigation.md).

### Recovery sequence (~23:31)

1. Stalled orchestrator pid **28011** + hung prune child **49065** (still present when implementation started)
2. Killed prune children under orchestrator PPID; force-stopped orchestrator
3. `node scripts/reconcile-queue.js` — fixed orphaned `downloading` rows
4. `./scripts/start-bulk-in-terminal.sh` — new session pid **33628** at **23:36**

### Soak evidence (post-fix, same session)

Bulk log `logs/bulk-download-20260708-2336.log`:

```
OK: 2018-expedition-max (verified, no gaps)
INCOMPLETE: 2016-f-250 — capture gaps remain
OK: 2016-f-250 (verified, no gaps)    ← auto-retry succeeded
START 2018-f-250 (parallel slot)
START 2019-f-250 (parallel slot)
```

| Observation | Implication |
|-------------|-------------|
| No hung `prune-cdp-tabs` under pid 33628 | RUN-01 fix working |
| `INCOMPLETE` → re-dispatch → `OK` on `2016-f-250` | Queue self-healing works |
| New tier-2 jobs dispatched after completions | Orchestrator not frozen |
| Workshop workers logging PDF downloads (~23:54) | Normal throughput |

**RUN-01 status:** Fix **deployed and early soak positive**. Full close-out: 30+ min with multiple OK/INCOMPLETE rotations without freeze (on track at checkpoint).

### `2016-f-250` TCM episode (~23:36–23:50)

During first connector pass, worker log frozen ~9+ min on `Saving connector TRANSMISSION CONTROL MODULE (TCM) (C1750)` while pid at **~99% CPU**. Process was **alive**, not dead — `reapStaleWorkers` did not act. Job eventually completed (`INCOMPLETE` then `OK` on retry). **This is the archetype for REL-01 (hung-alive worker)** — recovery was luck, not a bounded timeout.

---

## Queue metrics (checkpoint ~00:00)

| Metric | ~22:48 (pre-fix stall) | ~00:00 (post-fix) | Delta |
|--------|------------------------|-------------------|-------|
| `complete` | 59 | **61** | +2 (session) +2 (post-restart) |
| `downloading` | 2 (stuck) | 2 (active) | healthy in-flight |
| `needs_params` | 40 | **10** | −30 (capture retry pass) |
| `pending` | — | **221** | — |
| Tier 1 | 35/38 | **35/38** | — |
| Yarn workers | **0** (stall) | **2** | — |
| Tests | 68 | **75** | +7 |

**Current workers:** `2018-f-250`, `2019-f-250` (workshop/headless — CDP lock free).

**Remaining `needs_params` (10):** `2000/2001/2002-excursion` (pre-2003), `2003-f-250`, `2022/2023/2024-e-transit` (PTS catalog), `2012-escape`, `2010-taurus`, `2009-crown-victoria`.

---

## Param capture — session outcome

**Log:** `logs/capture-params-20260708-2114.log` (started ~21:14)

| Pass | Captured | Failed | Deferred |
|------|----------|--------|----------|
| First | 15 | 4 | 32 |
| Retry | 29 | 3 | 0 |

**Session net:** 15 new `params.json` files; `needs_params` 54 → **10**.

**Failures (persistent — not transient):**

| Vehicle | Error |
|---------|-------|
| `2003-f-250` | Workshop tab did not trigger TreeAndCover/workshop request |
| `2010-taurus` | `locator.waitFor` timeout 30s |
| `2009-crown-victoria` | PTS home `page.goto` 90s timeout |
| `2012-escape` | Execution context destroyed (navigation race) |
| `2022/2023/2024-e-transit` | Model not in PTS menu — **not** `modelMatchers` issue (RUN-06) |

**Capture process:** Log ends with "Pass done" / "Leaving your Chrome window open" but pid **29405** remains alive (~2.5h+, ~0.1% CPU). Does not self-exit — **REL-02**.

---

## Stale infrastructure (RUN-02 residual)

Orphan `prune-cdp-tabs` PIDs from **prior session** (not children of orchestrator 33628):

| PID | Age at checkpoint |
|-----|-------------------|
| 91052 / 91074 | ~4h20m |
| 91119 / 91141 | ~4h20m |

`CDP_DISCONNECT_TIMEOUT_MS` bounds new `browser.close()` calls; does **not** reap orphaned prune **processes** from crashed/old sessions. Engineering gap: **REL-03** (orphan prune reaper).

---

## Unsupervised reliability gaps

**Operator requirement:** 4–12+ hour unsupervised operation — no manual kill/restart as steady-state.

Guide 04.1 was **necessary** for parallel orchestration. It is **not sufficient** for the full bar.

| ID | Gap | Failure mode | 04.1 coverage |
|----|-----|--------------|---------------|
| **REL-01** | Hung-**alive** worker | Yarn PID lives, log frozen, high CPU — slot blocked indefinitely | **Partial** — only dead PID reap |
| **REL-02** | Capture no clean exit | Finished session leaves node process running | None |
| **REL-03** | Orphan prune accumulation | Old `prune-cdp-tabs` compete for CDP for hours | Partial — disconnect timeout only |
| **REL-04** | No process supervisor | Orchestrator crash → bulk stops until external restart | **Partial** — 04.2 stall detection in `ensure-bulk-running.sh`; launchd proof Phase G |
| **REL-05** | No orchestrator heartbeat | Cannot distinguish slow job vs freeze from bulk log alone | **Fixed** — 04.2 `[heartbeat]` lines |
| **REL-06** | No per-job wall clock | `yarn start` can run unbounded | None |
| **REL-07** | PTS/session drift | 403 bursts, UI timeouts, Chrome error tabs | Mitigated by cookie refresh (3h) + queue retry |

**Acceptance criteria for next reliability guide (candidate 04.2):**

- Orchestrator frees any worker slot within **N minutes** of hang (dead or alive-without-progress)
- Disk-truth queue patch on forced reap (same as 04.1 — do not use blind `exitCode=1`)
- No manual intervention over **12-hour soak** with `PARALLEL=2` on connector-heavy fleet
- Heartbeat line every poll tick: inFlight, pids, per-vid log mtime age

---

## Guide 04.2 — executed (2026-07-09)

**Dev guide:** [dev_guides/2026-07-09_dev_guide_04_2_unsupervised_reliability.md](./dev_guides/2026-07-09_dev_guide_04_2_unsupervised_reliability.md)

**Shipped:** `reapHungWorkers`, heartbeat, orphan prune reaper, capture CDP disconnect (REL-02), watchdog stall detection. **84** tests green.

**Operator:** Restart bulk when ready: `./scripts/start-bulk-in-terminal.sh` — watch for `[heartbeat]` and `[reap-hung]` in bulk log. Full 4h+ soak pending.

**Smoke test (2026-07-09 ~01:36 local):** Bulk restarted via `start-bulk-in-terminal.sh` on commit `7d2f918`. Log `logs/bulk-download-20260709-0136.log` shows `[heartbeat]` every ~5s, `[reap-prune]` killed RUN-02 orphans (91052/91119/…). Capture restarted via `start-capture-in-terminal.sh --limit 3` — REL-02 exit pending session completion.

---

## Guide 04.2 — implementation-ready (superseded)

**Working title:** Orchestrator unsupervised reliability — **see dev guide** (implementation-ready)

<details>
<summary>Legacy outline (superseded)</summary>

1. `WORKER_MAX_RUNTIME_MS` env (e.g. 4h default) — orchestrator sends SIGTERM to yarn child, then SIGKILL; `patchStaleWorkerFromDisk`
2. `reapHungWorkers` — alive PID but vehicle log mtime stale > `WORKER_LOG_STALE_MS` (e.g. 15–30 min)
3. Orchestrator heartbeat in `orchestratorTick` (OPS-06)
4. Optional: orphan prune reaper on tick (PIDs not under live orchestrator/worker, age > N min)

**Out of scope for 04.2:**

- launchd watchdog (Phase G / OPS-02)
- Capture self-exit (Guide 05 or 04.2.1)
- Changing `yarn start` exit codes on gaps
- E-Transit / pre-2003 catalog gaps

**Blast radius:**

| Risk | Mitigation |
|------|------------|
| Kill slow-but-valid connector job | Conservative stale threshold; only kill after log mtime + optional disk unchanged |
| Wrong queue status on kill | Reuse `patchStaleWorkerFromDisk` — never `fixOrphanDownloading(..., 1)` for incomplete disk |
| SIGKILL mid-write corrupts PDF | Same as crash today; reconcile + gap registry on retry |
| False positive on headless workshop (buffered logs) | Track log mtime per `logs/${vid}.log`; workshop logs frequently |

**Dependency:** Guide 04.1 executed (`6c15180`).

</details>

---

## Guide 04.2 — legacy outline (collapsed)

| Prior plan | Refinement |
|------------|------------|
| Guide 04.1 soak "pending" | **Early soak positive** — mark RUN-01 fix verified; full 30+ min close-out when session continues |
| Guide 05 "next" | Still valid for capture modularization; add **capture clean exit** to scope or REL-02 mini-fix |
| Phase G | Split: **04.2** = orchestrator unsupervised; **Phase G** = watchdog, pre-commit, health script consolidation |
| RUN-03 / RUN-04 | **Resolved** this session (`2016-f-250` OK, `2018-expedition-max` OK) |
| PIPE-01 needs_params 40 | Update to **10** — capture retry pass complete |
| P0 "bulk stall recovery" action item | **Obsolete** for RUN-01 — replace with REL-01 engineering |
| Operator manual steps in backlog | Remove as steady-state mitigation; document only as emergency rollback |

---

## Guide index (updated)

| Guide | Status |
|-------|--------|
| 01–04 | Executed |
| **04.1** | **Executed** (`6c15180`, 2026-07-09) — RUN-01 early soak positive |
| **04.2** | **Executed** (2026-07-09) — hung reap, heartbeat, orphan prune, capture exit, watchdog stall detect |
| 05 | Implementation-ready — after capture stopped |
| 06 | Plan — needs 05 + `legacy_pts_capture.md` |
| Phase G | Watchdog, hooks, consolidation — post-subscription or maintenance window |

---

## Open questions (engineering / product)

1. ~~**Worker max runtime:** 2h vs 4h vs 8h default~~ → **Resolved in 04.2:** `WORKER_MAX_RUNTIME_MS=14400000` (4h), tunable
2. ~~**Log stale threshold:** 15 min vs 30 min~~ → **Resolved in 04.2:** `WORKER_LOG_STALE_MS=1200000` (20 min); 15 min too aggressive given 2016 TCM ~9 min freeze that recovered
3. ~~**Guide 05 vs 04.2 order**~~ → **04.2 first** for unsupervised bulk; 05 when capture stopped
4. **Watchdog:** Prove launchd path vs accept Terminal-only supervision (OPS-02)? — Phase G; 04.2 adds stall **detection** only
5. **E-Transit:** Skip tier-1, manual params, or alternate PTS entry (RUN-06)?
6. **Tier-1 incomplete policy:** Always gap-retry vs accept `incomplete` and move on?

---

## Changelog

| Date | Update |
|------|--------|
| 2026-07-09 | Guide 04.2 executed — unsupervised reliability; 84 tests |

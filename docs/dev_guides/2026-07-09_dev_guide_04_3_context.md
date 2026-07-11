---
status: Ready
artifact_type: context-summary
work_item: 04.3-incomplete-retry-storm
pass: 5
readiness_score: 96
plan_package: docs/dev_guides/2026-07-10_plan_package_04_3_incomplete_retry_storm.md
readiness_report: docs/dev_guides/2026-07-09_dev_guide_04_3_incomplete_retry_storm.solidify-readiness-report.md
last_solidify: 2026-07-10
---

# Context summary — Dev Guide 04.3 (INCOMPLETE retry storm)

**Date:** 2026-07-09  
**Dev guide:** [2026-07-09_dev_guide_04_3_incomplete_retry_storm.md](./2026-07-09_dev_guide_04_3_incomplete_retry_storm.md)  
**Runtime evidence:** [../2026-07-09_pipeline_runtime_observations_am.md](../2026-07-09_pipeline_runtime_observations_am.md)  
**Issue:** REL-08 in [../known_issues_and_backlog.md](../known_issues_and_backlog.md)

---

## Problem statement

When an `incomplete` vehicle fast-fails on PTS auth (`subscriptionExpired`, 403), the orchestrator immediately re-dispatches it because `incomplete` has highest queue priority. Under `PARALLEL=2`, one slot can cycle hundreds of times per hour without productive work while the other slot runs normally.

**Session evidence:** `2024-bronco` ~691 `START`/`INCOMPLETE` cycles (~11:26–11:33 local); recovered after stale PTS session refresh. `2020-explorer` unaffected on parallel slot.

---

## Root cause chain (verified in code)

| # | Layer | Finding |
|---|-------|---------|
| 1 | `scripts/queue-lib.js` | `queueRank`: non-stale `incomplete` = **0** (beats `pending` = 20) |
| 2 | `lib/bulk-orchestrator-lib.js` `runOne` | `INCOMPLETE` branch returns **before** `authFailureIsRecent` + `recordAuthFailure` (FAIL path only) |
| 3 | `spawnYarnStart` | `createWriteStream(logPath)` truncates vehicle log each run — cross-run auth evidence lost |
| 4 | `src/wiring/saveEntireWiring.ts` ~98–148 | One `ignoreSaveErrors` catch handles Page, Connectors, and LocIndex failures without an outer auth gap. `savePage` and ordinary `saveConnector` failures already persist specific gaps; connector probe, connector `PtsAuthError`, and LocIndex terminal cases do not. |
| 5 | `STALE_GAP_ATTEMPTS` | Never triggers during storm because gap `attempts` stays at 1 (single record, no increment on skip path) |
| 6 | `spawnYarnStart` | Its `child.on("error")` ends the shared log stream while stdout/stderr pipes can still write. A subsequent write produces unhandled `ERR_STREAM_WRITE_AFTER_END` and crashes the orchestrator. |

---

## Scope boundaries

### In scope

- Auth-aware handling on INCOMPLETE exit path
- Per-vehicle fast-fail cooldown (exclude from `nextJob`)
- Narrow gap records for unrecorded auth-class ignored wiring outcomes: connector portal probe, terminal connector auth streak, and LocIndex only
- Unit tests + env vars + docs
- Auth evidence sidecar (`logs/recent-auth-events.jsonl`) — **core** (Step 3b); truncated logs break `authFailureIsRecent`
- Frozen cooldown/evidence contract shared with the dependent 04.4 plan
- Worker log-stream lifecycle guard so an auth-storm child error cannot terminate the orchestrator

### Out of scope

- Changing global `queueRank` bands
- Lowering `WORKER_LOG_STALE_MS` or `WORKER_MAX_RUNTIME_MS` (04.2 regression risk)
- launchd watchdog (Phase G)
- E-Transit / pre-2003 / capture modularization (Guides 06/07/05)
- Fast auth-class **FAIL** cooldown or in-worker auth-budget stops (Guide 04.4)
- Implementing during active subscription bulk

### Unclear / resolved

| Question | Resolution |
|----------|------------|
| Is `subscriptionExpired` subscription end? | **No** — usually stale PTS session (`src/ptsAuth.ts`, architecture.md); operator confirmed login works |
| Is worker idle during storm? | **No** — fast fail/restart loop; `pid:pending` between spawns |
| Does global circuit breaker help? | **Not today** — INCOMPLETE path skips `recordAuthFailure` |
| Can an old auth event classify a new run? | **No** — worker result classification uses current blocking gap reasons then its current log; durable JSONL is audit evidence only |
| Does 04.3 stop late-session `FAIL` auth loops? | **No** — `2013-taurus` / `2014-fiesta` exited `FAIL` with gaps on disk and still re-dispatched until the orchestrator crashed. 04.3 adds the stream guard and fast-auth **INCOMPLETE** cooldown only; 04.4 owns intentional exit-0 incomplete for partial auth `FAIL` paths |

---

## Runtime snapshot — 2026-07-10 ~21:15 local

Bulk has been **down since ~13:39 CDT** (~7.5 hours before this audit).

| Metric | Value |
|--------|-------|
| Complete | **129** (+11 since the 11:47 snapshot) |
| Incomplete | **12** (unchanged; 14,522 PDFs; 3,441 workshop `auth` gaps; all stale) |
| Failed | **36** (unchanged; all zero-PDF, no `capture-gaps.json`) |
| Downloading | **2 orphaned** (`2013-taurus`, `2014-fiesta`; 1,096 PDFs; 1,392 new auth gaps) |
| Reusable partial PDFs | **~15.6k** across 14 rows |
| Processes | **0** orchestrator / **0** workers |
| Lock | **Stale** `logs/bulk-download.lock` (pid 33924 dead) |

**Terminal failure:** `ERR_STREAM_WRITE_AFTER_END` in `spawnYarnStart` while restarting `2013-taurus` after `FAIL: 2014-fiesta` and `FAIL: 2013-taurus` with cookie refresh. This matches root-cause item 6 and is why the stream guard is in scope.

**Operator recovery before any 04.3 code:** `./scripts/pipeline-health.sh --fix-locks`, `node scripts/reconcile-queue.js`, `./scripts/queue-status.sh --health`, then blessed Terminal restart. Do not conflate that recovery with implementing 04.3.

---

## Dependencies

| Prerequisite | Status |
|--------------|--------|
| Guide 04.1 (RUN-01) | Executed |
| Guide 04.2 (hung reap, heartbeat) | Executed; **10h+ soak passed** |
| Bulk stopped for code changes | **Required** — orchestrator reload |
| `yarn test` green | Required at Phase 0 |

---

## Acceptance criteria

1. After 3 fast auth INCOMPLETE fails (<60s runtime), vehicle excluded from dispatch for 15 min (default).
2. During exclusion, other slot picks `pending` vehicle (parallelism restored).
3. Slow legitimate INCOMPLETE (connector progress, runtime >60s) **not** cooled down.
4. Gap `attempts` increment for every currently unrecorded auth-class ignored wiring outcome: connector portal probe, terminal connector auth streak, and LocIndex. Page and ordinary connector paths retain their existing specific records without duplication.
5. `[cooldown]` / `[auth-incomplete]` visible in bulk log and one durable auth event survives vehicle-log truncation.
6. `yarn test` green; no 04.2 hung-reap regression; reaped workers do not increment fast-fail cooldown.
7. A simulated child `error` followed by delayed stdout/stderr and `close` does not emit an unhandled stream error or terminate the orchestrator.

## Knowledge status

| Status | Fact / decision | Evidence or resolution |
|--------|-----------------|------------------------|
| **Known** | Queue selection occurs in `startWorkers` through `nextJob`, after the circuit-breaker gate. | `lib/bulk-orchestrator-lib.js` |
| **Known** | `connectorPreflight()` is the existing live-content proof and already clears fleet auth stamps. | `lib/bulk-orchestrator-lib.js` |
| **Known** | Only canonical page and connector gap-id helpers exist. | `src/captureGaps.ts` |
| **Known** | `saveConnector` throws `PtsAuthError` after its three-consecutive-auth threshold before persisting a terminal connector-auth-streak record. | `src/wiring/saveConnector.ts` |
| **Known** | The last bulk log ends in `ERR_STREAM_WRITE_AFTER_END` after repeated auth-bearing failures; the health check reports no bulk process, a stale lock, and two orphaned `downloading` rows. | `logs/bulk-download-20260710-0022.log`; live health check at ~21:16 |
| **Assumed, verify in Phase 0** | `connectorPreflight()` success is sufficiently strong to clear per-vehicle auth cooldowns. | Add a mocked preflight-success test and operator verification against a stale-session recovery. |
| **Assumed, verify in Phase 0** | A local `connectorPortalReady` flag separates probe from terminal connector-auth-streak errors without changing ordinary connector behavior. | Add focused ignored-error tests around the existing lower-level record paths. |
| **Unknown — non-blocking** | The exact historical cause of every `2024-bronco` attempt remains unproven. | Cooldown behavior does not depend on this attribution. |

---

## Blast radius

| Area | Touch |
|------|-------|
| `lib/bulk-orchestrator-lib.js` | `spawnYarnStart`, `runOne`, `startWorkers`, `connectorPreflight` plumbing |
| `lib/vehicle-cooldown.js` | **New** small module |
| `src/wiring/saveEntireWiring.ts` | Narrow records for probe, terminal connector-auth-streak, and LocIndex outcomes |
| `test/` | New + extend orchestrator tests |
| Runtime state | `logs/vehicle-cooldown.json`, `logs/recent-auth-events.jsonl` (gitignored via `logs/`) |

**Not touched:** `bulk-download.sh`, CDP lock, capture-params, queue JSON schema.

---

## Implementation risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cooldown suppresses legitimate gap retry | Medium | Require auth signal (log + gap reason), not runtime alone |
| Truncated log breaks `authFailureIsRecent` | **High** | Core durable auth-event sidecar; current gap reasons remain first-class classification evidence |
| Cooldown file corruption | Low | Atomic write; orchestrator single-writer |
| Global circuit breaker + cooldown interaction | Medium | Document tick order: prune cooldown → circuit check → dispatch |
| Subscription lapse during test | Low | Test with mocked auth; manual verify on stale session |
| Future 04.4 creates duplicate policy | Medium | Freeze one orchestrator-owned cooldown/evidence contract before code |
| A worker child error crashes the orchestrator | **High** | `spawnYarnStart` must not end the piped log stream on `error`; close owns stream shutdown and the stream has an error listener |

---

## Rollback

`git revert` the 04.3 commit; delete `logs/vehicle-cooldown.json` and `logs/recent-auth-events.jsonl`; restart bulk from Terminal.app.

---

## Operator notes (pre-implementation)

- **Do not implement while any active bulk orchestrator is running** unless the operator accepts a deliberate stop/restart. Do not rely on a historical PID.
- `subscriptionExpired` and CDN 403 signals are not proof that the paid subscription has ended; verify a live PTS content probe before diagnosing a true subscription lapse.
- The immediate safe action during active bulk is documentation and evidence gathering only. Guide 04.3 implementation waits for the Phase 0 gate.

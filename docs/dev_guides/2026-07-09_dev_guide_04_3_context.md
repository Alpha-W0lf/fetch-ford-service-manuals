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
| 4 | `src/wiring/saveEntireWiring.ts` ~140–147 | Connectors-only auth failure caught with `Skipping ${doc.Title}...` — **does not** call `captureGaps.record()` |
| 5 | `STALE_GAP_ATTEMPTS` | Never triggers during storm because gap `attempts` stays at 1 (single record, no increment on skip path) |

---

## Scope boundaries

### In scope

- Auth-aware handling on INCOMPLETE exit path
- Per-vehicle fast-fail cooldown (exclude from `nextJob`)
- Gap record on connectors-only section skip when auth-related
- Unit tests + env vars + docs
- Auth evidence sidecar (`logs/recent-auth-events.jsonl`) — **core** (Step 3b); truncated logs break `authFailureIsRecent`

### Out of scope

- Changing global `queueRank` bands
- Lowering `WORKER_LOG_STALE_MS` or `WORKER_MAX_RUNTIME_MS` (04.2 regression risk)
- launchd watchdog (Phase G)
- E-Transit / pre-2003 / capture modularization (Guides 06/07/05)
- Implementing during active subscription bulk

### Unclear / resolved

| Question | Resolution |
|----------|------------|
| Is `subscriptionExpired` subscription end? | **No** — usually stale PTS session (`src/ptsAuth.ts`, architecture.md); operator confirmed login works |
| Is worker idle during storm? | **No** — fast fail/restart loop; `pid:pending` between spawns |
| Does global circuit breaker help? | **Not today** — INCOMPLETE path skips `recordAuthFailure` |

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
4. Gap `attempts` increment on repeated connectors-only auth skip.
5. `[cooldown]` / `[auth-incomplete]` visible in bulk log.
6. `yarn test` green; no 04.2 hung-reap regression.

---

## Blast radius

| Area | Touch |
|------|-------|
| `lib/bulk-orchestrator-lib.js` | `runOne`, `startWorkers` exclude list |
| `lib/vehicle-cooldown.js` | **New** small module |
| `src/wiring/saveEntireWiring.ts` | Gap record in connectors skip catch |
| `test/` | New + extend orchestrator tests |
| Runtime state | `logs/vehicle-cooldown.json` (gitignored via `logs/`) |

**Not touched:** `bulk-download.sh`, CDP lock, capture-params, queue JSON schema.

---

## Implementation risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cooldown suppresses legitimate gap retry | Medium | Require auth signal (log + gap reason), not runtime alone |
| Truncated log breaks `authFailureIsRecent` | **High** | **Promote Tier B:** auth stamp sidecar or append log — needed for reliable Tier A |
| Cooldown file corruption | Low | Atomic write; orchestrator single-writer |
| Global circuit breaker + cooldown interaction | Medium | Document tick order: prune cooldown → circuit check → dispatch |
| Subscription lapse during test | Low | Test with mocked auth; manual verify on stale session |

---

## Rollback

`git revert` 04.3 commit; delete `logs/vehicle-cooldown.json`; restart bulk from Terminal.app.

---

## Operator notes (pre-implementation)

- **Do not implement while bulk pid 75301 running** unless operator accepts orchestrator restart.
- Subscription expected to lapse soon — 04.3 would help post-renewal, not before lapse.
- Immediate safe actions: commit docs + `tsconfig` fix; delete stray `src/**/*.js` emit artifacts (CODE-12).

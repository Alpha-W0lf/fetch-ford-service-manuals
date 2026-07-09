# Dev Guide 04.3: INCOMPLETE Retry Storm & Auth Cooldown

## 🎯 Objective

Stop **parallel-slot waste** when `incomplete` vehicles fast-fail on auth (`subscriptionExpired`, 403) while preserving INCOMPLETE auto-retry for legitimate gap-fill (e.g. `2018-transit`, `2016-f-250`).

## 📚 Critical Context & References

> **CRITICAL:** Read before implementation.

* **Context summary:** [2026-07-09_dev_guide_04_3_context.md](./2026-07-09_dev_guide_04_3_context.md) — **read before implementation**
* **Issue registry:** [../known_issues_and_backlog.md](../known_issues_and_backlog.md) — REL-08, REL-09
* **Parent guides (executed):** [04.1](./2026-07-09_dev_guide_04_1_orchestrator_reliability.md), [04.2](./2026-07-09_dev_guide_04_2_unsupervised_reliability.md)
* **Queue selection:** `scripts/queue-lib.js` — `queueRank`, `isStaleIncomplete`, `STALE_GAP_ATTEMPTS`
* **Orchestrator:** `lib/bulk-orchestrator-lib.js` — `runOne` INCOMPLETE vs FAIL paths, `circuitBreakerBlocksStart`
* **Auth detection:** `lib/bulk-auth-log.js`, `src/ptsAuth.ts`, `manuals/<id>/capture-gaps.json` gap `reason`
* **Architecture:** [../reference/architecture.md](../reference/architecture.md) — `subscriptionExpired` = stale session
* **Agent:** `AGENTS.md` — smallest correct change; **bulk stopped** for implementation
* **Execution workflow:** `second_brain/docs/guides/prompt_follow_dev_guide.md`

**Gate:** Bulk **stopped** + `yarn test` green + read AM observations doc.

**Why 04.3?** 04.2 fixed hung workers and orchestrator freeze. 04.3 fixes **fast-fail retry storms** that waste `PARALLEL=2` slots without improving recovery speed.

---

## Problem statement (REL-08)

| Factor | Current behavior | Problem |
|--------|------------------|---------|
| `queueRank` | `incomplete` (non-stale) = **0** (highest) | Auth-failing vehicle monopolizes a slot |
| `runOne` INCOMPLETE path | Returns before `recordAuthFailure` | Circuit breaker never trips |
| `spawnYarnStart` | Truncates `logs/<vid>.log` each run | Cross-run auth evidence lost |
| `STALE_GAP_ATTEMPTS` | Deprioritize at 10 attempts | Gap `attempts` stayed at 1 during storm — accounting bug |
| Recovery | Cookie refresh / manual login | Works eventually but slot wasted until then |

**Session evidence:** `2024-bronco` ~691 `START`/`INCOMPLETE` in ~1h; `2020-explorer` healthy on other slot. Stale PTS session at 11:26; recovered ~11:33.

---

## Scope tiers

### Tier A — In scope (04.3 core)

| # | Deliverable |
|---|-------------|
| 1 | **Auth-aware INCOMPLETE** — after INCOMPLETE, if `authFailureIsRecent(logPath)` OR blocking gap `reason` ∈ `{auth, subscription-expired}`: call `recordAuthFailure` |
| 2 | **Per-vehicle cooldown** — track fast fails; exclude from `nextJob` for N min; dispatch next `pending` |
| 3 | **Fix gap attempt accounting** — ensure warmup auth failures increment `captureGaps.record().attempts` |
| 4 | **Operator visibility** — `[cooldown]`, `[auth-incomplete]` log lines |
| 5 | **Tests** — unit tests for cooldown state machine + queue exclusion |

### Tier B — Same PR if low risk

| # | Deliverable |
|---|-------------|
| 7 | **Pre-dispatch PTS probe** — skip connectors-only START if PTS Chrome on auth redirect (trigger cookie refresh once) |

Tier B item 6 (log/sidecar auth evidence) **promoted to Step 3b** — required for reliable circuit breaker on INCOMPLETE path.

### Out of scope

- Changing `queueRank` bands globally (prefer cooldown over deprioritizing all incomplete)
- Lowering `WORKER_LOG_STALE_MS` (04.2 regression risk)
- launchd watchdog (Phase G)
- E-Transit / pre-2003 catalog (Guide 06/07)

---

## 🏗️ Architectural pattern

> **Pattern:** Fast-fail detection + per-vehicle cooldown + existing circuit breaker  
> **Flow:** `runOne` → INCOMPLETE + auth? → `recordAuthFailure` + increment fast-fail counter → `nextJob` skips cooled-down vids  
> **Constraint:** Never mark `complete` on forced cooldown; disk truth unchanged

### Proposed env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `VEHICLE_FAST_FAIL_SEC` | `60` | Job runtime below this = "fast fail" |
| `VEHICLE_FAST_FAIL_COUNT` | `3` | Fast fails before cooldown |
| `VEHICLE_COOLDOWN_SEC` | `900` | Exclude vehicle from dispatch (15 min) |
| `VEHICLE_COOLDOWN_STATE` | `logs/vehicle-cooldown.json` | Sidecar state file (or in-memory + persist on tick) |

---

## 📋 Implementation checklist

### Step 1: Auth on INCOMPLETE path

* [ ] In `runOne`, after INCOMPLETE log line, read log + `capture-gaps.json` reasons
* [ ] If auth-related: `recordAuthFailure(config.recent403File, vid, deps.log)`
* [ ] **Reference:** mirror FAIL path at `bulk-orchestrator-lib.js` ~582–584

### Step 2: Cooldown state module

* [ ] New `lib/vehicle-cooldown.js` — `recordFastFail(vid, runtimeSec)`, `isExcluded(vid)`, `pruneExpired()`
* [ ] Persist to `logs/vehicle-cooldown.json` (atomic write)
* [ ] Wire into `nextJob` exclude list in `startWorkers`

### Step 3: Gap attempt accounting (root cause identified)

**Root cause:** `saveEntireWiring.ts` connectors-only catch (`Skipping ${doc.Title}...`) does **not** call `captureGaps.record()` on auth warmup failure — so `attempts` never increments and `STALE_GAP_ATTEMPTS` never deprioritizes.

* [ ] In `saveEntireWiring.ts` catch block: when `connectorsOnly` && auth-related error, `captureGaps.record()` with stable gap id
* [ ] Repro test: repeated auth fail increments `attempts`; `isStaleIncomplete` true at 10
* [ ] **Do not** rely on orchestrator-only fix for this — gap must be recorded in worker

### Step 3b: Auth evidence when log truncated (promote from Tier B — recommended for Tier A)

Truncated vehicle logs break `authFailureIsRecent` on INCOMPLETE path. **Include in core PR:**

* [ ] On auth INCOMPLETE, append one line to `logs/recent-auth-events.jsonl` (vid, ts, reason) — or rotate-append vehicle log
* [ ] `runOne` reads sidecar OR current log for auth decision

### Step 4: Tests

* [ ] `test/vehicle-cooldown.test.js`
* [ ] Extend `test/bulk-orchestrator.test.ts` — INCOMPLETE + auth records failure + cooldown excludes vid

### Step 5: Docs

* [ ] `docs/reference/env_vars.md`
* [ ] `known_issues_and_backlog.md` — mark REL-08 resolved
* [ ] `architecture.md` — cooldown paragraph

---

## ✅ Verification & definition of done

* [ ] Simulated fast-fail: same vid excluded after 3 sub-60s INCOMPLETE auth fails
* [ ] Other slot dispatches `pending` vehicle during cooldown (not stuck on storm vid)
* [ ] Legitimate slow INCOMPLETE (connector progress) **not** cooled down
* [ ] `yarn test` green; no regression on 04.2 hung-reap tests
* [ ] Manual: stale PTS session → cooldown logs → recovery after cookie refresh dispatches successfully

---

## ⚠️ Blast radius & risks

| Risk | Mitigation |
|------|------------|
| Cooldown hides real gaps too long | Default 15 min; env tunable; only on **fast** auth fails |
| False positive on slow auth page load | Use runtime threshold + auth log/gap reason, not runtime alone |
| Sidecar file races | Atomic write; orchestrator single-writer |
| Regression on `2018-transit` INCOMPLETE→OK | Cooldown only when auth signals present |

**Rollback:** Revert 04.3 commit; delete `logs/vehicle-cooldown.json`; restart bulk.

---

## Status

**Plan — implementation-ready after bulk stops** (context + guide refined 2026-07-09 12:06).  
**Not** for implementation during active subscription bulk. Execute after bulk stop + operator go-ahead + Phase 0 gate (`prompt_follow_dev_guide.md`).

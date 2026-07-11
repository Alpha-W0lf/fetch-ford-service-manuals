---
status: Executed
artifact_type: dev-guide
context_summary: docs/dev_guides/2026-07-09_dev_guide_04_3_context.md
plan_package: docs/dev_guides/2026-07-10_plan_package_04_3_incomplete_retry_storm.md
readiness_report: docs/dev_guides/2026-07-09_dev_guide_04_3_incomplete_retry_storm.solidify-readiness-report.md
pass: 10
readiness_score: 96
last_solidify: 2026-07-10
---

# Dev Guide 04.3: INCOMPLETE Retry Storm & Auth Cooldown

## 🎯 Objective

Stop **parallel-slot waste** when `incomplete` vehicles fast-fail on auth (`subscriptionExpired`, 403) while preserving INCOMPLETE auto-retry for legitimate gap-fill (e.g. `2018-transit`, `2016-f-250`).

## 📚 Critical Context & References

> **CRITICAL:** Read before implementation.

* **Plan package (approval required):** [2026-07-10_plan_package_04_3_incomplete_retry_storm.md](./2026-07-10_plan_package_04_3_incomplete_retry_storm.md)
* **Readiness report:** [2026-07-09_dev_guide_04_3_incomplete_retry_storm.solidify-readiness-report.md](./2026-07-09_dev_guide_04_3_incomplete_retry_storm.solidify-readiness-report.md)
* **Context summary:** [2026-07-09_dev_guide_04_3_context.md](./2026-07-09_dev_guide_04_3_context.md) — **read before implementation**
* **Issue registry:** [../known_issues_and_backlog.md](../known_issues_and_backlog.md) — REL-08
* **Parent guides (executed):** [04.1](./2026-07-09_dev_guide_04_1_orchestrator_reliability.md), [04.2](./2026-07-09_dev_guide_04_2_unsupervised_reliability.md)
* **Queue selection:** `scripts/queue-lib.js` — `queueRank`, `isStaleIncomplete`, `STALE_GAP_ATTEMPTS`
* **Orchestrator:** `lib/bulk-orchestrator-lib.js` — `runOne` INCOMPLETE vs FAIL paths, `circuitBreakerBlocksStart`
* **Auth detection:** `lib/bulk-auth-log.js`, `src/ptsAuth.ts`, `manuals/<id>/capture-gaps.json` gap `reason`
* **Architecture:** [../reference/architecture.md](../reference/architecture.md) — `subscriptionExpired` = stale session
* **Agent:** `AGENTS.md` — smallest correct change; **bulk stopped** for implementation
* **Execution workflow:** `second_brain/docs/guides/prompt_follow_dev_guide.md`

**Planning gate:** Documentation review, source inspection, and plan validation are safe while bulk continues.  
**Implementation gate:** Bulk **stopped** + `yarn test` green + read AM observations doc. If bulk stopped due to a crash, run operator recovery (fix locks, reconcile queue, health check) before Phase 0 tests — but do not treat that recovery as implementing 04.3. Do not modify source, run live failure reproduction, or restart the pipeline until this gate passes and the user approves the plan package.

**04.3 vs 04.4 boundary:** 04.3 fixes the orchestrator stream crash, fast-auth **INCOMPLETE** cooldown, and narrow wiring gap accounting. It does **not** add cooldown for fast auth-class **FAIL** exits or in-worker workshop auth-budget stops. The 2026-07-10 evening crash loop (`2013-taurus` / `2014-fiesta`) was a **FAIL** path with partial gaps until the stream bug terminated the orchestrator; 04.4 converts those paths to intentional exit-0 `incomplete` outcomes.

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

**Session evidence:** `2024-bronco` experienced an approximately 09:30–11:33 retry storm, including an acute stale-session `subscriptionExpired` window around 11:26–11:33; `2020-explorer` remained healthy on the other slot.

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
| 6 | **Worker log stream guard** — child `error` cannot end a still-piped log stream or crash the orchestrator |

### Deferred follow-up — not part of 04.3

**Pre-dispatch PTS probe** is deferred to 04.4 investigation. A standalone probe can misclassify a transient CDP/tab state and suppress legitimate connector gap-fill. Any later probe must require the same durable auth evidence used by cooldown, not merely a redirect observation.

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

### Frozen 04.3 → 04.4 contract

`lib/vehicle-cooldown.js` is the only per-vehicle dispatch-suppression mechanism.

* **Writer:** the orchestrator only. Workers communicate auth evidence through `capture-gaps.json`; `runOne` writes the durable auth event after it classifies the completed worker result.
* **API:** `createVehicleCooldownStore(file)` returns `recordOutcome(vid, { runtimeSec, authClass, finalStatus })`, `isExcluded(vid, now)`, `pruneExpired(now)`, and `clearAuthCooldowns()`.
  * `authClass` is one of `auth`, `subscription-expired`, or `null`.
  * In 04.3, only an `incomplete` outcome with non-null `authClass` and `runtimeSec < VEHICLE_FAST_FAIL_SEC` increments the per-vehicle counter. Slow and non-auth outcomes leave that counter unchanged; a verified recovery signal clears it.
  * On the configured count, `recordOutcome` persists the expiry and returns the vehicle to the normal scheduler only after expiry or `clearAuthCooldowns()`. It must not alter queue status or disk artifacts.
* **State:** `logs/vehicle-cooldown.json`, written atomically. Its records contain only vehicle id, expiry, consecutive-count, and last auth classification—never cookies, URLs with credentials, or arbitrary error bodies.
* **Evidence precedence:** classify the just-finished run from blocking gap reasons first, then the current vehicle log. The JSONL sidecar is durable audit evidence for that already-classified result; it never turns an otherwise non-auth run into an auth outcome. `recent-403-stamps.txt` remains the fleet circuit-breaker input; do not repurpose it.
* **04.4 extension:** reaches this cooldown only through a deliberate auth-budget exit-0 `incomplete` outcome with persisted gaps. When the worker log contains `[auth-budget-stop]`, `recordOutcome` may increment the cooldown counter **without** the `runtimeSec < VEHICLE_FAST_FAIL_SEC` requirement (partial runs are often slow). It must not add generic FAIL-path suppression, another cooldown file, scheduler, or queue-rank system.

### Proposed env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `VEHICLE_FAST_FAIL_SEC` | `60` | Job runtime below this = "fast fail" |
| `VEHICLE_FAST_FAIL_COUNT` | `3` | Fast fails before cooldown |
| `VEHICLE_COOLDOWN_SEC` | `900` | Exclude vehicle from dispatch (15 min) |
| `VEHICLE_COOLDOWN_FILE` | `logs/vehicle-cooldown.json` | Persistent cooldown state file |
| `VEHICLE_AUTH_EVENTS_FILE` | `logs/recent-auth-events.jsonl` | Append-only orchestrator audit evidence |

---

## 📋 Implementation checklist

### Step 1: Tests first — define the state transitions

* [x] Add `test/vehicle-cooldown.test.ts` first: state transitions, expiry, atomic-state recovery, and `clearAuthCooldowns()`.
* [x] Extend `test/bulk-orchestrator.test.ts` first: auth INCOMPLETE fleet/cooldown behavior, durable event, circuit threshold, exclusion, and preflight cooldown clear.
* [x] Add `test/saveEntireWiring-auth-gap.test.ts` first: exact non-duplicating probe, terminal connector-auth-streak, LocIndex, ordinary page/connector, and non-auth behaviors.
* [x] Add a `spawnYarnStart` regression to `test/bulk-orchestrator.test.ts` first: emit child `error`, then delayed stdout/stderr data, then `close`; assert the promise settles once and no unhandled write-after-end error occurs. Export `spawnYarnStart` from `bulk-orchestrator-lib.js` for this test (or inject `deps.spawn` through `runOne` if export is undesirable).
* [x] Run the affected tests to establish expected failing behavior before implementation; use isolated temp paths and mocked processes, clock, CDP, and child streams.

### Step 2: Make worker log-stream shutdown single-owner

* [x] In `spawnYarnStart`, the child `error` handler must settle the worker result but **must not** call `logStream.end()`.
* [x] The child `close` handler is the only normal stream-end owner; retain the existing `settled` guard so `error` followed by `close` resolves once.
* [x] Add a `logStream.on("error", ...)` handler that reports the stream error through the orchestrator logger without throwing an unhandled process-level error.
* [x] Do not change worker kill, reaper, queue-patch, or retry behavior in this step.

### Step 3: Auth on INCOMPLETE path

* [x] Import `readCaptureGaps` and `blockingGaps` from `scripts/capture-gaps-lib.js`. Add a JS-local `isAuthGapReason(reason)` that accepts only `auth` and `subscription-expired`. In `runOne`, after the INCOMPLETE log line, classify from blocking gap reasons first and the current vehicle log second.
* [x] If auth-related: `recordAuthFailure(config.recent403File, vid, deps.log)`
* [x] Append the durable JSONL event for every classified auth INCOMPLETE, then call the cooldown store only for the fast-auth state-machine transition.
* [x] **Reference:** mirror FAIL path at `bulk-orchestrator-lib.js` ~582–584

### Step 4: Cooldown state module

* [x] New `lib/vehicle-cooldown.js` exports `createVehicleCooldownStore(file)` and owns all JSON parsing, atomic rewrite, expiry pruning, and state-machine transitions.
* [x] In `loadConfig`, add the four cooldown values and the two runtime file paths. In `runOrchestrator`, construct one store and retain it on `state`; use `(Date.now() - entry.startedAt) / 1000` after `spawnYarnStart()` resolves for `runtimeSec`.
* [x] Persist to `logs/vehicle-cooldown.json` using the same atomic-write pattern as other orchestrator state files (write temp + rename)
* [x] Do not count reaped/hung workers as fast failures; Guide 04.2 remains the owner of those outcomes
* [x] In `orchestratorTick`, prune expired cooldowns before its existing circuit-breaker check; in `startWorkers`, merge `isExcluded()` ids into the existing `excludeIds` immediately before its `nextJob` call
* [x] Change `connectorPreflight(config, deps)` to receive the existing `state`, and on success call `state.vehicleCooldown.clearAuthCooldowns()` beside `clearAuthFailureStamps()`. Update `runStartup` and `maybeRefreshCookies` call sites. Never clear cooldown state on cookie-export success alone.

### Step 5: Gap attempt accounting (root cause identified)

**Verified bug:** `saveEntireWiring.ts` catches auth-class connector probe, connector, and section failures under `ignoreSaveErrors` without calling `captureGaps.record()`. This is a contributor to future retry churn; it does not by itself prove the historic `2024-bronco` attempt count.

* [x] Do **not** add a generic outer record for Page / BasicPage errors: `savePage` already owns their per-page capture-gap record.
* [x] In `saveEntireWiring.ts`, add a `connectorPortalReady` boolean immediately after successful `probeConnectorAccess()`. Classify its outer catch with `e instanceof PtsAuthError ? e.reason : gapReasonFromError(e)`. When `captureGaps` exists and that reason is auth-class, record exactly one gap only for:
  * a connector portal probe before `connectorPortalReady`: `wiringConnectorGapId(doc.Number, "__probe__")`;
  * a `PtsAuthError` from connector capture after portal readiness: `wiringConnectorGapId(doc.Number, "__auth-streak__")`;
  * a LocIndex failure: `wiringPageGapId(doc.Number, "loc-index")`.
* [x] Leave ordinary `saveConnector` per-connector failures to its existing `wiringConnectorGapId(doc.Number, connector.Name)` record. This avoids duplicate attempts and preserves the most actionable missing artifact.
* [x] Repro test: repeated auth fail increments `attempts`; `isStaleIncomplete` true at 10
* [x] **Do not** rely on orchestrator-only fix for this — gap must be recorded in worker

### Step 5a: Confirm durable auth evidence behavior

Truncated vehicle logs break log-only detection on the INCOMPLETE path. The durable event belongs in the same core change as Step 3:

* [x] On auth INCOMPLETE, append one line to `logs/recent-auth-events.jsonl` (vid, ts, reason, final status).
* [x] Preserve the frozen precedence: current blocking gaps, then current vehicle log; JSONL is durable audit evidence, not an independent classifier.

### Step 6: Complete and run tests

* [x] Verify slow non-auth INCOMPLETE and reaped/hung worker outcomes do not increment cooldown
* [x] Verify the first-run tests are green after implementation and preserve exact probe, terminal connector-auth-streak, LocIndex, ordinary page/connector, and non-auth assertions.

### Step 7: Docs

* [x] `docs/reference/env_vars.md`
* [x] `known_issues_and_backlog.md` — mark REL-08 resolved
* [x] `architecture.md` — cooldown paragraph

---

## ✅ Verification & definition of done

### Pre-Phase 0 operator recovery (when bulk already stopped)

If the orchestrator is down with stale locks or orphaned `downloading` rows, complete this checklist **before** Phase 0 code work:

* [ ] `./scripts/pipeline-health.sh --fix-locks`
* [ ] `node scripts/reconcile-queue.js`
* [ ] `./scripts/queue-status.sh --health` — confirm lock state and queue counts
* [ ] Do **not** restart bulk until after 04.3 implementation, tests, and user approval (or an explicit operator decision to resume on current code)

### Implementation verification

* [x] Simulated fast-fail: same vid excluded after 3 sub-60s INCOMPLETE auth fails
* [x] Other slot dispatches `pending` vehicle during cooldown (not stuck on storm vid)
* [x] Legitimate slow INCOMPLETE (connector progress) **not** cooled down
* [x] Child `error` followed by delayed stream output and `close` does not crash the orchestrator, leak a stream error, or resolve the worker twice
* [x] `yarn test` green; no regression on 04.2 hung-reap tests
* [x] `yarn typecheck` green
* [ ] After the stopped-run test suite, run `node scripts/reconcile-queue.js` and inspect `./scripts/queue-status.sh --health` before the blessed Terminal.app restart
* [ ] Manual: stale PTS session → cooldown logs → recovery after cookie refresh dispatches successfully

---

## ⚠️ Blast radius & risks

| Risk | Mitigation |
|------|------------|
| Cooldown hides real gaps too long | Default 15 min; env tunable; only on **fast** auth fails; preflight success clears auth cooldowns |
| False positive on slow auth page load | Use runtime threshold + auth log/gap reason, not runtime alone |
| Sidecar file races | Atomic write; orchestrator single-writer |
| Fast auth-class FAIL still wastes a slot until 04.4 | Documented boundary; stream guard prevents orchestrator death; 04.4 converts verified paths to exit-0 incomplete |

**Rollback:** Revert the 04.3 commit; delete `logs/vehicle-cooldown.json` and `logs/recent-auth-events.jsonl`; restart bulk through the blessed Terminal.app path.

---

## Status

**Executed** (2026-07-10) — REL-08 resolved; 98 tests green. Operator recovery + live soak remain before blessed bulk restart.

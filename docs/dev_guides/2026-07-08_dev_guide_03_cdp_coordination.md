# Dev Guide 03: CDP Coordination and Lock Tests

## 🎯 Objective

Encode CDP lock behavior in tests and document lock scopes so bulk connectors and param capture can interleave safely without ad-hoc fixes.

## 📚 Critical Context & References

* **Architecture:** `docs/reference/architecture.md` (locks section)
* **Env:** `docs/reference/env_vars.md` (CDP_* variables)
* **Code:** `scripts/cdp-chrome-lock.js`, `src/cdpConnectorPage.ts`, `scripts/capture-params.ts`, `src/wiring/saveConnector.ts`
* **Prior work:** Dev Guide 02 (Vitest harness, lock unit tests baseline)
* **Execution:** `second_brain/docs/guides/prompt_follow_dev_guide.md`

**Gate:** Dev Guide 02 complete (`yarn test` green, `lib/capture-gaps-rules` aligned).

## 🏗️ Architectural Pattern

> **Pattern:** Short lock scopes + tested yield/defer  
> **Flow:** Bulk: `withCdpChromeLock` per connector → release → capture may acquire per vehicle  
> **Constraint:** Never hold CDP lock across entire vehicle job; never prune live `/wiring/face` tabs during active connector job.

### Code map (verified 2026-07-08)

| Concern | Location | Env vars |
|---------|----------|----------|
| CDP lock acquire/release | `scripts/cdp-chrome-lock.js` | — |
| Connector lock wrapper | `src/cdpConnectorPage.ts` → `withCdpChromeLock` | `CDP_LOCK_WAIT_MS` |
| Per-connector scope | `src/wiring/saveConnector.ts` line ~73 | — |
| Capture first pass yield | `scripts/capture-params.ts` → `runCaptureSession` | `CDP_LOCK_YIELD_MS` (default 120000) |
| Capture retry pass wait | same, `deferOnLockBusy: false` | `CDP_LOCK_WAIT_MS` (default 600000) |
| Tab prune (safe) | `lib/cdp-tab-hygiene.js` + `pruneOrphanCdpTabs` | `CDP_MAX_CONNECTOR_TABS` |
| Exit hook release | `cdpConnectorPage.ts` `process.on('exit')` | — |

**Workshop/wiring (`src/index.ts`):** headless Playwright — **no** `cdp-chrome.lock`.

## 📋 Implementation Checklist

### Step 0: Preflight

* [x] Dev Guide 02 complete (Vitest + lock/patch-queue tests)
* [x] Read `pruneCdpOrphanTabs` connector-job-active branch (`cdpConnectorPage.ts` ~214–230)
* [x] Read `runCaptureSession` defer path (`capture-params.ts` ~787–796, ~817–818)

### Step 1: Extract pure helpers (minimal)

* [x] `lib/cdp-tab-hygiene.js` — extract from `cdpConnectorPage.ts`
* [x] `lib/cdp-capture-defer.js` — extract from `capture-params.ts`
* [x] `cdpConnectorPage.ts` + `capture-params.ts` import from lib (behavior unchanged)

### Step 2: Lock behavior tests (extend Guide 02 baseline)

* [x] `test/cdp-chrome-lock.test.ts` — holder mismatch, acquire after release
* [x] Stale lock: dead PID removed on acquire
* [x] Test names reference `CDP_LOCK_YIELD_MS` vs `CDP_LOCK_WAIT_MS`

### Step 3: Capture defer policy tests (pure, no Playwright)

* [x] `test/cdp-capture-defer.test.ts` — table-driven defer cases

### Step 4: Tab hygiene tests (pure)

* [x] `test/cdp-tab-hygiene.test.ts` — URL fixtures

### Step 5: Connector lock scope (contract test)

* [x] `test/saveConnector-lock-scope.test.ts`
* [x] Document: lock **not** held across full vehicle in `saveConnector` (per connector PDF only)

### Step 6: Documentation

* [x] Add `docs/reference/cdp_tab_hygiene.md`
* [x] Confirm `docs/pipeline-scheduling.md` links to tab hygiene reference

## ✅ Verification & Definition of Done

* [x] `yarn test` includes CDP lock wait, defer policy, and tab hygiene cases (58 tests)
* [x] No live PTS Chrome required for CI
* [x] No production lock behavior change (extract + test only)
* [x] Architecture reference still accurate

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Changing lock semantics during subscription | **High** | Extract + test only; behavior-preserving refactors |
| Extracting too much from capture-params | Medium | Two small pure libs; full modularization is Guide 05 |
| Flaky timing tests | Medium | Avoid real waits; busy-spin blocks event loop in lock acquire |
| Tab helper extraction changes prune behavior | **High** | Pure extraction with identical logic; tab hygiene tests |

**Rollback:** Revert test + extract commits.

**Safe during active bulk:** Yes — behavior-preserving; **restart capture-params** to load extracted defer helpers (optional; logic unchanged).

---

**Status:** **Executed** (2026-07-08)  
**Depends on:** Dev Guide 02 (executed)  
**Blocks:** Dev Guide 04 (orchestrator — bulk must stop)

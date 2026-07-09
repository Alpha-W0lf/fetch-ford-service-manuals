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

```
bulk connector          capture-params
     |                        |
     +-- acquire (short) -----+-- acquire (per vehicle)
     +-- release              +-- release (finally)
```

### Code map (verified 2026-07-08)

| Concern | Location | Env vars |
|---------|----------|----------|
| CDP lock acquire/release | `scripts/cdp-chrome-lock.js` | — |
| Connector lock wrapper | `src/cdpConnectorPage.ts` → `withCdpChromeLock` | `CDP_LOCK_WAIT_MS` |
| Per-connector scope | `src/wiring/saveConnector.ts` line ~73 | — |
| Capture first pass yield | `scripts/capture-params.ts` → `runCaptureSession` | `CDP_LOCK_YIELD_MS` (default 120000) |
| Capture retry pass wait | same, `deferOnLockBusy: false` | `CDP_LOCK_WAIT_MS` (default 600000) |
| Tab prune (safe) | `src/cdpConnectorPage.ts` → `pruneCdpOrphanTabs` | `CDP_MAX_CONNECTOR_TABS` |
| Exit hook release | `cdpConnectorPage.ts` `process.on('exit')` | — |

**Workshop/wiring (`src/index.ts`):** headless Playwright — **no** `cdp-chrome.lock`.

## 📋 Implementation Checklist

### Step 0: Preflight

* [x] Dev Guide 02 complete (Vitest + lock/patch-queue tests)
* [ ] Read `pruneCdpOrphanTabs` connector-job-active branch (`cdpConnectorPage.ts` ~214–230)
* [ ] Read `runCaptureSession` defer path (`capture-params.ts` ~787–796, ~817–818)

### Step 1: Extract pure helpers (minimal)

* [ ] `lib/cdp-tab-hygiene.js` — extract from `cdpConnectorPage.ts`:
  - `isConnectorCaptureTab(url)` — `/wiring/face`
  - `isChromeErrorTab(url)`
  - `isSafePruneDuringConnectorJob(url)` — only `about:blank` + chrome-error (never `/wiring/face`)
  - `shouldSkipDisposableClose(page, keptConnectorSet)` — logic from prune loop ~246–248
* [ ] `lib/cdp-capture-defer.js` — extract from `capture-params.ts`:
  - `shouldDeferOnLockAcquireFailure(deferOnLockBusy, acquired)`
  - `shouldDeferOnLockTimeoutError(deferOnLockBusy, errMsg)`
* [ ] `cdpConnectorPage.ts` + `capture-params.ts` import from lib (behavior unchanged)

### Step 2: Lock behavior tests (extend Guide 02 baseline)

* [ ] `test/cdp-chrome-lock.test.ts` — add: second holder waits with `maxWaitMs`, succeeds after release
* [ ] Stale lock: dead PID removed on acquire (already covered — keep)
* [ ] Holder mismatch on release: no-op (document in test name)
* [ ] Test names reference `CDP_LOCK_YIELD_MS` (capture first pass) vs `CDP_LOCK_WAIT_MS` (connectors + capture retry)

### Step 3: Capture defer policy tests (pure, no Playwright)

* [ ] `test/cdp-capture-defer.test.ts` — table-driven:
  - first pass + acquire fails → defer
  - first pass + acquire succeeds → no defer
  - retry pass + acquire fails → throw (no defer)
  - timeout error message + deferOnLockBusy → defer path

### Step 4: Tab hygiene tests (pure)

* [ ] `test/cdp-tab-hygiene.test.ts` — URL fixtures:
  - `/wiring/face` → connector tab, not safe prune during active job
  - `about:blank`, `chrome-error://` → safe prune during active job
  - disposable loop skips live connector tabs

### Step 5: Connector lock scope (contract test)

* [ ] `test/saveConnector-lock-scope.test.ts` — static analysis or grep-based test that `saveConnector.ts` calls `withCdpChromeLock` and `index.ts` does not require cdp lock
* [ ] Document: lock **not** held across full vehicle in `saveConnector` (per connector PDF only)

### Step 6: Documentation

* [ ] Add `docs/reference/cdp_tab_hygiene.md` — disposable vs protected URLs + active-job rules (link from `architecture.md`)
* [ ] Confirm `docs/pipeline-scheduling.md` matches extracted helpers (no duplicate prose in `PIPELINE_OPS.md`)

## ✅ Verification & Definition of Done

* [ ] `yarn test` includes CDP lock wait, defer policy, and tab hygiene cases
* [ ] No live PTS Chrome required for CI
* [ ] No production lock behavior change (extract + test only unless bug found)
* [ ] Architecture reference still accurate

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Changing lock semantics during subscription | **High** | Extract + test only; behavior-preserving refactors |
| Extracting too much from capture-params | Medium | Two small pure libs; full modularization is Guide 05 |
| Flaky timing tests | Medium | Mock lock module; no real 120s waits in CI |
| Tab helper extraction changes prune behavior | **High** | Pure extraction with identical logic; tab hygiene tests |

**Rollback:** Revert test + extract commits.

**Safe during active bulk:** Yes — if behavior-preserving and tests prove parity before merge.

---

**Status:** Plan only — **implementation-ready** (refined 2026-07-08)  
**Depends on:** Dev Guide 02 (executed)  
**Blocks:** Dev Guides 04, 05

**Not in scope (defer):**
- `sleepMs` busy-spin → `Atomics.wait` in `cdp-chrome-lock.js` (optional perf)
- Full `capture-params.ts` modularization (Guide 05)
- Live CDP integration tests

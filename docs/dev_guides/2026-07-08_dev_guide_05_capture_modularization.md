# Dev Guide 05: Capture-Params Modularization

## 🎯 Objective

Split `scripts/capture-params.ts` (**890 lines**) into focused modules under `src/capture/` without changing PTS navigation behavior, CDP lock policy, or queue patch semantics.

## 📚 Critical Context & References

> **CRITICAL:** Read before implementation.

* **Monolith:** `scripts/capture-params.ts` (890 lines)
* **Shared auth:** `src/ptsAuth.ts` (`ensurePtsSessionHealthy`, `recoverPtsPageSession`)
* **Cookies:** `src/transformCookieString.ts`, `src/constants.ts` (`USER_AGENT`, `SEC_CH_UA`)
* **CDP lock/defer:** `scripts/cdp-chrome-lock.js`, `lib/cdp-capture-defer.js` (Guide 03 — **executed**)
* **Queue patch:** `lib/patch-queue.js` (Guide 02 — **use direct import**, not `execFile` to CLI)
* **State machine:** `docs/reference/queue_state_machine.md`
* **Env vars:** `docs/reference/env_vars.md` (capture + CDP sections — **already documented**)
* **Architecture:** `docs/reference/architecture.md`
* **Agent:** `AGENTS.md` — param capture requires **restart** after code changes
* **Ops:** `docs/PIPELINE_OPS.md`, `docs/2026-07-08_pipeline_inventory_and_action_items.md`
* **Execution workflow:** `second_brain/docs/guides/prompt_follow_dev_guide.md`
* **Golden log (optional):** `logs/capture-params-20260708-2114.log` — successful OK lines + defer pattern

**Gate:** Capture **stopped** before implementation. **Bulk may continue** — CDP lock serializes access.

## 🏗️ Architectural Pattern

> **Pattern:** CLI thin shell + domain modules  
> **Flow:** `yarn capture-params` → `scripts/capture-params.ts` (compat) → `src/capture/cli.ts` → session → navigation → intercept → `patch-queue`  
> **Constraint:** No behavior change in first pass; file moves and exports only until unit tests exist per pure module.

### Two-pass capture flow (preserve exactly)

```
main()
  ├── filter/sort needs_params targets (vehicleQueue)
  ├── connectBrowser + getPtsPage (cdpSession)
  ├── runCaptureSession(targets, deferOnLockBusy=true)   # first pass
  │     └── per vehicle: acquire lock (yield) → captureParams → write params → patch pending
  └── if deferred.length > 0:
        runCaptureSession(deferred, deferOnLockBusy=false)  # retry pass (CDP_LOCK_WAIT_MS)
```

### Proposed layout

```
scripts/capture-params.ts     # thin compat: import/run src/capture/cli main
src/capture/
  cli.ts                      # parseArgs, main(), runCaptureSession (~120 lines target)
  types.ts                    # VehicleEntry, Queue, VidContext, CaptureSessionOpts
  args.ts                     # parseArgs (--limit, --tier, --all, --no-cdp, --include-legacy)
  vehicleQueue.ts             # filterNeedsParams, sortCaptureTargets, legacy defer
  modelMatchers.ts            # PTS model alias table (pure)
  networkIntercept.ts         # WORKSHOP_KEYS, createCaptureState, buildParams, isRetryableCaptureError
  ptsNavigation.ts            # commitVehicle, selectModel, tabs, VIN, iframe flow
  cdpSession.ts               # connectBrowser, getPtsPage, applyCookies, shouldResetPtsAfterVehicle
  captureFlow.ts              # captureParamsOnce, captureParams (one retry)
  pacing.ts                   # sleep, CAPTURE_* env, batch pause helpers
  log.ts                      # logStep (optional one-liner module)
test/
  modelMatchers.test.ts
  vehicleQueue.test.ts
  networkIntercept.test.ts
  isRetryableCaptureError.test.ts
```

**Target:** no file >400 lines; `ptsNavigation.ts` may approach 350 — split `vidFrame.ts` only if needed.

### `capture-params.ts` code map (parity source)

| Symbol | Lines (approx) | Target module |
|--------|----------------|---------------|
| `patchVehicleStatus` (execFile CLI) | 49–51 | **Migrate** → `lib/patch-queue.js` in `cli.ts` |
| `sleep` | 64–66 | `pacing.ts` |
| `VidContext`, `VehicleEntry`, `Queue` | 68–82 | `types.ts` |
| `WORKSHOP_KEYS` | 84–104 | `networkIntercept.ts` |
| `parseArgs` | 106–123 | `args.ts` |
| `modelMatchers` | 125–143 | `modelMatchers.ts` |
| `createCaptureState` | 145–198 | `networkIntercept.ts` |
| `applyCookies`, `isCdpPortUp`, `connectBrowser` | 200–260 | `cdpSession.ts` |
| `getBrowserContext`, `getPtsPage`, `dismissBlockingModals` | 261–310 | `cdpSession.ts` |
| `logStep` | 307–309 | `log.ts` |
| `ensurePtsHome`, `resetPtsSession`, `getVidFrame` | 311–382 | `ptsNavigation.ts` |
| `clickYearModelTab`, `selectModel`, `selectYear` | 383–503 | `ptsNavigation.ts` |
| `waitForVehicleCommitted`, `submitExampleVin` | 435–481 | `ptsNavigation.ts` |
| `commitVehicle`, `clickPtsMainTab`, `openWorkshopAndWiring` | 504–568 | `ptsNavigation.ts` |
| `isRetryableCaptureError` | 570–584 | `networkIntercept.ts` |
| `buildParams` | 586–625 | `networkIntercept.ts` |
| `captureParamsOnce`, `captureParams` | 627–654 | `captureFlow.ts` |
| `main` queue filter/sort | 656–694 | `vehicleQueue.ts` + `cli.ts` |
| `main` browser bootstrap + two-pass | 696–757 | `cli.ts` + `cdpSession.ts` |
| `shouldResetPtsAfterVehicle` | 759–764 | `cdpSession.ts` |
| `runCaptureSession` | 775–885 | `cli.ts` (uses pacing, cdp lock, captureFlow) |

### Import path notes (TypeScript + CommonJS interop)

* **CDP lock** (stay JS): from `src/capture/cli.ts` use  
  `require('../../scripts/cdp-chrome-lock')` — **single import site** in `cdpSession.ts` or `cli.ts`.
* **CDP defer** (stay JS): `require('../../lib/cdp-capture-defer')`.
* **Patch queue** (stay JS):  
  `const { patchVehicleStatus } = require('../../lib/patch-queue')`  
  Call as `patchVehicleStatus(QUEUE_PATH, vehicleId, 'pending')`.
* **Do not** duplicate `PATCH_QUEUE` CLI spawn.

### Known tech debt to fix in Guide 05 (low risk, in scope)

1. **`patchVehicleStatus` spawns CLI** → `lib/patch-queue.js` direct call.
2. **Hardcoded `templates/vehicles.json`** — keep for parity; document `CAPTURE_QUEUE_PATH` as optional follow-up (Guide 05.1 or Phase G).

### Out of scope (do not change in Guide 05)

* PTS navigation selectors, timeouts, retry counts
* `lib/cdp-capture-defer.js` semantics
* `pre_2003` placeholder URL in `buildParams` — Guide 06 replaces with real legacy flow
* `bulk-orchestrator-lib.js` size (~668 lines) — separate optional split

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [ ] **Capture stopped** (operator confirmation — `./scripts/start-capture-in-terminal.sh --restart` after deploy)
* [x] Dev Guide 03 complete (CDP defer tests green)
* [x] Dev Guide 04 complete + live soak validated (2026-07-08)
* [x] Golden reference log available: `logs/capture-params-20260708-2114.log`
* [ ] `yarn test` green before starting (68 tests baseline)

### Step 1: Extract pure helpers (no Playwright)

* [ ] `src/capture/modelMatchers.ts` + `test/modelMatchers.test.ts`
* [ ] `src/capture/vehicleQueue.ts` — `selectCaptureTargets(queue, opts)` + tests:
  * tier filter, `--all` limit, modern-before-legacy sort, `--include-legacy`, pre-2003 defer message
* [ ] `isRetryableCaptureError` → `networkIntercept.ts` + table-driven tests (strings from lines 573–582)
* [ ] `buildParams` unit test with fixture workshop/wiring objects (valid + missing vehicleId)

### Step 2: Extract network intercept

* [ ] `networkIntercept.ts` — `WORKSHOP_KEYS`, `createCaptureState`, `buildParams`
* [ ] Unit test: mock `Request` with workshop POST + wiring GET URLs populate maps

### Step 3: Extract CDP session

* [ ] `cdpSession.ts` — `connectBrowser`, `getBrowserContext`, `getPtsPage`, `applyCookies`, `isCdpPortUp`, `shouldResetPtsAfterVehicle`
* [ ] Single `cdp-chrome-lock` require site
* [ ] Reuse `lib/cdp-capture-defer.js` unchanged

### Step 4: Extract PTS navigation + capture flow

* [ ] `ptsNavigation.ts` — frame/VIN/year/model/tab flow (largest extract)
* [ ] `captureFlow.ts` — `captureParamsOnce`, `captureParams` (one retry on retryable error)
* [ ] Wire `ptsAuth` recovery calls in `cli.ts` / `runCaptureSession` (unchanged behavior)
* [ ] **No Playwright DOM unit tests** in first pass — manual smoke only

### Step 5: CLI + compat entry

* [ ] `src/capture/cli.ts` — `main`, `runCaptureSession`, two-pass defer/retry
* [ ] `scripts/capture-params.ts` → `import './capture/cli'` or re-export `main`
* [ ] Optional: `"capture-params": "ts-node src/capture/cli.ts"` in `package.json` **only if** compat script kept
* [ ] Migrate `patchVehicleStatus` to `lib/patch-queue.js`
* [ ] `run-capture-params.sh`, `start-capture-in-terminal.sh` — **no path changes**

### Step 6: Verification

* [ ] `yarn test` green (baseline 68 + new capture tests)
* [ ] `yarn typecheck` green
* [ ] No file >400 lines without header justification
* [ ] `yarn capture-params --limit 1` live smoke (operator, PTS Chrome logged in)
* [ ] Compare one OK vehicle params.json byte-for-byte with pre-split capture (or schema-equivalent)
* [ ] Update `docs/reference/architecture.md` capture module paths
* [ ] Guide 03 tests unchanged and passing

## ✅ Verification & Definition of Done

* [ ] All modules under 400 lines (or justified)
* [ ] `modelMatchers` + `isRetryableCaptureError` table tests
* [ ] `vehicleQueue` sort/filter tests
* [ ] Capture restart picks up new code; one vehicle captured successfully
* [ ] `patch-queue` lib used directly (no `execFile` to CLI)
* [ ] Two-pass defer/retry behavior preserved (grep log for "retry pass" / "deferring")

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| PTS navigation regression | **High** | Strangler extract; `git revert` + capture restart; smoke `--limit 1` per merge |
| CDP lock behavior change | **High** | Guide 03 tests must pass; no edits to defer lib |
| Import path / ts-node resolution | Medium | Keep `scripts/capture-params.ts` as entry; test `yarn capture-params` |
| `require()` from TS in `src/capture/` | Medium | Follow bulk pattern; minimal CJS requires at module boundaries |
| Bulk + capture parallel ops | Medium | No code change; lock/defer already proven live 2026-07-08 |
| Accidental `pre_2003` URL change | Low | `buildParams` test asserts placeholder shape until Guide 06 |

**Rollback:** `git revert`; `./scripts/start-capture-in-terminal.sh --restart`.

**Safe during active bulk:** **Yes** (bulk continues; **capture must stop** for implementation).

**Safe during active capture:** **NO**.

---

## Strangler order (mandatory sequence)

1. Pure: `modelMatchers`, `vehicleQueue`, `isRetryableCaptureError`, `buildParams` tests
2. `networkIntercept.ts` + request mock tests
3. `pacing.ts`, `log.ts`, `types.ts`, `args.ts`
4. `cdpSession.ts` (move only)
5. `ptsNavigation.ts` + `captureFlow.ts` (single commit or two; run typecheck between)
6. `cli.ts` + thin `scripts/capture-params.ts`
7. `patch-queue` lib migration
8. `yarn test && yarn typecheck`
9. Operator: stop capture → deploy → `yarn capture-params --limit 1` → `--restart` full session

---

## `modelMatchers` table-driven tests (required)

| `ptsModel` input | Expected matchers (subset) |
|------------------|---------------------------|
| `F-650` | `F-650/750`, `F-650` |
| `F-750` | `F-650/750`, `F-750` |
| `Expedition MAX` | `Expedition Max`, `Expedition` |
| `Expedition Max` | `Expedition Max`, `Expedition MAX`, `Expedition` |
| `E-Transit` | `E-Transit`, `E Transit`, `E-Transit Cargo Van` |
| `Police Interceptor Utility` | `Police Interceptor Utility`, `Explorer` |
| `Police Interceptor Sedan` | `Police Interceptor Sedan`, `Taurus` |
| `F-150` (default) | `F-150` only |

## `isRetryableCaptureError` table-driven tests (required)

Each substring in the implementation (lines 573–582) must have one positive test case; one negative case (e.g. `"timeout"` alone) must return false.

---

**Status:** Plan only — **implementation-ready** (refined 2026-07-08 pass 2)  
**Depends on:** Dev Guide 03 (**executed**), Dev Guide 04 (**executed**)  
**Blocks:** Dev Guide 06 (pre-2003 capture automation)

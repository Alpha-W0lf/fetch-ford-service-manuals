# Dev Guide 05: Capture-Params Modularization

## 🎯 Objective

Split `scripts/capture-params.ts` (891 lines) into focused modules under `src/capture/` without changing PTS navigation behavior, CDP lock policy, or queue patch semantics.

## 📚 Critical Context & References

* **Monolith:** `scripts/capture-params.ts` (891 lines)
* **Shared auth:** `src/ptsAuth.ts`, `src/transformCookieString.ts`
* **CDP lock/defer:** `scripts/cdp-chrome-lock.js`, `lib/cdp-capture-defer.js` (Guide 03 — **executed**)
* **Queue patch:** `lib/patch-queue.js` (Guide 02 — prefer direct import over `execFile` to `patch-queue.js` CLI)
* **State machine:** `docs/reference/queue_state_machine.md`
* **Architecture:** `docs/reference/architecture.md`
* **Agent:** `AGENTS.md` — param capture requires **restart** after code changes
* **Ops:** `docs/PIPELINE_OPS.md`, `docs/2026-07-08_pipeline_inventory_and_action_items.md`

**Gate:** Capture **stopped** before implementation (like Guide 04 for bulk). Bulk may continue running during Guide 05 — CDP lock serializes access.

## 🏗️ Architectural Pattern

> **Pattern:** CLI thin shell + domain modules  
> **Flow:** `scripts/capture-params.ts` (compat re-export) → `src/capture/cli.ts` → session → navigation → intercept → `patch-queue`  
> **Constraint:** No behavior change in first pass; file moves and exports only until unit tests exist per module.

```
scripts/capture-params.ts     # one-line re-export (yarn capture-params compat)
src/capture/
  cli.ts                      # parseArgs, main(), runCaptureSession loop
  types.ts                    # VehicleEntry, Queue, VidContext
  vehicleQueue.ts             # filter/sort needs_params targets
  modelMatchers.ts            # PTS model alias table (pure)
  networkIntercept.ts         # createCaptureState, WORKSHOP_KEYS, buildParams
  ptsNavigation.ts            # commitVehicle, selectModel, tabs, VIN flow
  cdpSession.ts               # connectBrowser, getPtsPage, lock acquire/release
  pacing.ts                   # CAPTURE_DELAY_SEC, pause every N, consecutive fail stop
```

### `capture-params.ts` code map (parity source)

| Symbol | Lines (approx) | Node target |
|--------|----------------|-------------|
| `parseArgs` | 106–123 | `src/capture/cli.ts` or `args.ts` |
| `modelMatchers` | 125–143 | `src/capture/modelMatchers.ts` |
| `createCaptureState` / `WORKSHOP_KEYS` | 84–198 | `src/capture/networkIntercept.ts` |
| `applyCookies`, `isCdpPortUp`, `connectBrowser` | 200–260 | `src/capture/cdpSession.ts` |
| `getPtsPage`, `dismissBlockingModals` | 261–310 | `src/capture/cdpSession.ts` |
| `ensurePtsHome`, `resetPtsSession`, `getVidFrame` | 311–382 | `src/capture/ptsNavigation.ts` |
| `clickYearModelTab`, `selectModel`, `selectYear` | 383–503 | `src/capture/ptsNavigation.ts` |
| `commitVehicle`, `clickPtsMainTab`, `openWorkshopAndWiring` | 504–569 | `src/capture/ptsNavigation.ts` |
| `isRetryableCaptureError`, `buildParams` | 570–625 | `networkIntercept.ts` + `ptsNavigation.ts` |
| `captureParamsOnce`, `captureParams` | 627–654 | `src/capture/captureFlow.ts` (or `ptsNavigation.ts`) |
| `main` queue filter/sort | 656–694 | `src/capture/vehicleQueue.ts` |
| `main` browser bootstrap | 696–718 | `src/capture/cdpSession.ts` |
| `runCaptureSession` | 775–885 | `src/capture/cli.ts` |
| `shouldResetPtsAfterVehicle` | 759–764 | `src/capture/cdpSession.ts` |
| `patchVehicleStatus` (execFile CLI) | 49–51 | **Migrate** to `lib/patch-queue` direct call |

### Known tech debt to fix in Guide 05 (low risk)

1. **`patchVehicleStatus` spawns CLI** — replace with `patchVehicleStatus(QUEUE_PATH, id, status)` from `lib/patch-queue.js` (same as bulk orchestrator after Guide 04).
2. **Hardcoded `templates/vehicles.json`** — keep for now (parity); optional follow-up: `CAPTURE_QUEUE_PATH` env.

### `modelMatchers` table-driven tests (required)

| `ptsModel` input | Expected matchers (subset) |
|------------------|---------------------------|
| `F-650` | `F-650/750`, `F-650` |
| `F-750` | `F-650/750`, `F-750` |
| `Expedition MAX` | `Expedition Max`, `Expedition` |
| `E-Transit` | `E-Transit`, `E Transit`, `E-Transit Cargo Van` |
| `Police Interceptor Utility` | `Police Interceptor Utility`, `Explorer` |
| `F-150` (default) | `F-150` only |

### Env vars (capture)

| Variable | Default | Module |
|----------|---------|--------|
| `CDP_URL` | `http://127.0.0.1:9222` | `cdpSession.ts` |
| `USE_CDP` | `true` (set `false` for `--no-cdp`) | `cli.ts` |
| `CAPTURE_DELAY_SEC` | `4` | `pacing.ts` |
| `CAPTURE_PAUSE_EVERY` | `25` | `pacing.ts` |
| `CAPTURE_PAUSE_SEC` | `60` | `pacing.ts` |
| `CAPTURE_MAX_CONSECUTIVE_FAILS` | `5` | `pacing.ts` |
| `CDP_LOCK_YIELD_MS` | `120000` | `cli.ts` (first pass defer) |
| `CDP_LOCK_WAIT_MS` | `600000` | `cli.ts` (retry pass) |

Document in `docs/reference/env_vars.md` capture section if missing.

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [ ] **Capture stopped** (operator confirmation)
* [x] Dev Guide 03 complete (CDP defer tests green)
* [ ] Dev Guide 04 complete + bulk soak passed (recommended before heavy capture work)
* [ ] Optional: save tail of last successful capture log as golden reference (`logs/capture-params-*.log`)
* [ ] `yarn test` green before starting

### Step 1: Extract pure helpers (no Playwright)

* [ ] `modelMatchers.ts` + `test/modelMatchers.test.ts`
* [ ] `vehicleQueue.ts` — `filterNeedsParams`, `sortCaptureTargets` + tests (tier, modern-first, legacy defer)
* [ ] `buildParams` shape test with fixture workshop/wiring objects

### Step 2: Extract network intercept

* [ ] `networkIntercept.ts` — `WORKSHOP_KEYS`, `createCaptureState`, `buildParams`
* [ ] Unit test: mock `Request` URLs populate workshop/wiring maps

### Step 3: Extract CDP session

* [ ] `cdpSession.ts` — `connectBrowser`, `getPtsPage`, `applyCookies`, `shouldResetPtsAfterVehicle`
* [ ] Keep single `require('./cdp-chrome-lock')` import site
* [ ] Reuse `lib/cdp-capture-defer.js` (do not duplicate defer logic)

### Step 4: Extract PTS navigation

* [ ] `ptsNavigation.ts` — frame/VIN/year/model/tab flow
* [ ] `captureFlow.ts` — `captureParams` + one retry on retryable error
* [ ] **No unit tests required for Playwright DOM** in first pass — manual smoke only

### Step 5: CLI + compat entry

* [ ] `src/capture/cli.ts` — `main`, `runCaptureSession`, pacing, consecutive-fail stop
* [ ] `scripts/capture-params.ts` → `require('../src/capture/cli')` or `import './capture/cli'`
* [ ] Migrate `patchVehicleStatus` to `lib/patch-queue.js`
* [ ] `run-capture-params.sh`, `start-capture-in-terminal.sh` — path unchanged

### Step 6: Verification

* [ ] `yarn test` green
* [ ] No file >400 lines without comment justification
* [ ] `yarn capture-params --limit 1` live smoke (operator, PTS Chrome logged in)
* [ ] Update `docs/reference/architecture.md` capture paths

## ✅ Verification & Definition of Done

* [ ] All modules under 400 lines (or justified in file header)
* [ ] `modelMatchers` table tests for tier-1 aliases
* [ ] Capture restart picks up new code; one vehicle captured successfully
* [ ] `patch-queue` lib used directly (no `execFile` to CLI)
* [ ] Guide 03 CDP tests still pass unchanged

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| PTS navigation regression | **High** | Incremental extract; manual smoke per step; keep monolith commit handy |
| CDP lock behavior change | **High** | Guide 03 tests must pass; no edits to `cdp-capture-defer.js` semantics |
| Import path breaks ts-node | Medium | Keep `scripts/capture-params.ts` compat entry |
| Bulk + capture CDP contention | Medium | Existing lock + defer; no change planned |
| `page.goto` timeout storms | Medium | Ops: refresh PTS Chrome before restart (not a code change) |

**Rollback:** `git revert`; restart capture from previous commit.

**Safe during active bulk:** **Yes** (bulk continues; capture must restart after deploy).

**Safe during active capture:** **NO** — stop capture before implementation.

---

## Strangler order (recommended)

1. Pure: `modelMatchers` + `vehicleQueue` (tests first)
2. `networkIntercept` (tests with mock requests)
3. `cdpSession` (move only, no behavior change)
4. `ptsNavigation` + `captureFlow` (largest chunk)
5. `cli.ts` + thin `scripts/capture-params.ts`
6. `patch-queue` lib migration
7. Live smoke `--limit 1`

---

**Status:** Plan only — **implementation-ready** (refined 2026-07-08)  
**Depends on:** Dev Guide 03 (**executed**); Dev Guide 04 recommended complete first  
**Blocks:** Dev Guide 06 (pre-2003 capture automation)

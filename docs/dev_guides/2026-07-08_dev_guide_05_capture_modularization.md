# Dev Guide 05: Capture-Params Modularization

## 🎯 Objective

Split `scripts/capture-params.ts` (883 lines) into focused modules under `src/capture/` without changing PTS navigation behavior or CDP lock policy.

## 📚 Critical Context & References

* **Monolith:** `scripts/capture-params.ts`
* **Shared auth:** `src/ptsAuth.ts`, `src/transformCookieString.ts`
* **CDP:** Dev Guide 03 contracts
* **Queue:** `patch-queue.js`, `docs/reference/queue_state_machine.md`
* **Agent:** Param capture requires restart after code changes

## 🏗️ Architectural Pattern

> **Pattern:** CLI thin shell + domain modules  
> **Flow:** `scripts/capture-params.ts` (or `src/capture/cli.ts`) → navigation → intercept → lock policy → write params  
> **Constraint:** No behavior change; file moves and exports only until tests exist.

**Proposed layout:**

```
src/capture/
  cli.ts              # argv parsing, main()
  vehicleQueue.ts     # sort, filter needs_params
  ptsNavigation.ts    # captureParams(), modelMatchers
  networkIntercept.ts # workshop/wiring payload capture
  cdpSession.ts       # connectBrowser, lock acquire/release policy
  types.ts
scripts/capture-params.ts  # re-export entry for yarn capture-params (compat)
```

## 📋 Implementation Checklist

### Step 0: Preflight

* [ ] Dev Guide 03 complete (CDP tests document current behavior)
* [ ] Plan capture restart window with operator (subscription throughput)
* [ ] Optional: record one successful capture log as golden reference

### Step 1: Extract pure helpers first

* [ ] `modelMatchers(ptsModel)` → `src/capture/modelMatchers.ts` with table-driven tests (E-Transit, F-650/750, Expedition)
* [ ] Sort/filter logic → `vehicleQueue.ts` with unit tests

### Step 2: Extract CDP session

* [ ] `connectBrowser`, `getPtsPage`, lock yield/defer → `cdpSession.ts`
* [ ] Keep `require('./cdp-chrome-lock')` in one place

### Step 3: Extract navigation + intercept

* [ ] `captureParams()` and network listeners → separate files
* [ ] Preserve `WORKSHOP_KEYS` and intercept URLs exactly

### Step 4: CLI entry

* [ ] `package.json` `"capture-params": "ts-node src/capture/cli.ts"` (or keep scripts path as re-export)
* [ ] `run-capture-params.sh` unchanged or updated path only

### Step 5: Verification

* [ ] `yarn capture-params --limit 1` against live PTS (manual, operator)
* [ ] `yarn test` green
* [ ] No file >400 lines without comment justification
* [ ] Update `docs/reference/architecture.md` paths if entry moves

## ✅ Verification & Definition of Done

* [ ] All files under 400 lines (or justified)
* [ ] `modelMatchers` table tests for known tier-1 aliases
* [ ] Capture restart picks up new code; one vehicle captured successfully
* [ ] `patch-queue.js` still used for status updates (no whole-queue rewrite)

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| PTS navigation regression | **High** | Incremental extract; manual smoke per step |
| CDP lock behavior change | High | Guide 03 tests must pass unchanged |
| Import path breaks ts-node | Medium | Keep compat entry in `scripts/` |

**Rollback:** Revert; restart capture from previous commit.

**Safe during active bulk:** Bulk can run; **capture must restart** after deploy.

---

**Status:** Plan only — **not implemented**  
**Depends on:** Dev Guide 03  
**Blocks:** Dev Guide 06

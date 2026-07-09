# Dev Guide 02: Test Harness and Pure Lib Consolidation

## 🎯 Objective

Add a purposeful automated test suite and consolidate duplicated gap/path logic so queue behavior and download exit codes use one tested contract (`docs/reference/schemas.md`).

## 📚 Critical Context & References

> **CRITICAL:** Read before writing any code.

* **Strategy:** `docs/2026-07-08_codebase_foundation_context_assessment.md`
* **Contracts:** `docs/reference/schemas.md` (blocking matrix is canonical)
* **Architecture:** `docs/reference/architecture.md` (JS vs TS gap asymmetry)
* **Work standards:** `second_brain/docs/guides/prompt_work_session_standards.md`
* **Execution:** `second_brain/docs/guides/prompt_follow_dev_guide.md`
* **Agent rules:** `AGENTS.md`

**Gate:** Tom must approve `schemas.md` blocking / hybrid-complete rules before Step 2.

## 🏗️ Architectural Pattern

> **Pattern:** Test-driven contract lock + single source of truth  
> **Flow:** Extract shared pure functions → table-driven tests from `schemas.md` → TS imports shared module → JS scripts `require` same module  
> **Constraint:** Queue truth follows JS semantics today; TS aligns to schema, not the reverse.

**Recommended module layout:**

```
lib/
  capture-gaps-rules.js    # isBlockingGap, hybrid complete (pure, no fs)
  path-resolve.js          # pathColonDashVariants, fileExists helpers (from consolidation)
test/
  fixtures/
  capture-gaps-rules.test.ts
  bulk-lock.test.ts
  cdp-chrome-lock.test.ts
  queue-lib.test.ts
  path-resolve.test.ts
  httpRetry.test.ts
```

Do **not** emit to gitignored `dist/`. Use committed `lib/` or keep tested `.js` with TS re-exports via `src/`.

## 📋 Implementation Checklist

### Step 0: Preflight

* [x] Read `prompt_follow_dev_guide.md` Phase 0
* [x] Confirm Tom approval on `schemas.md` blocking matrix
* [x] Verify bulk healthy or accept no restart needed for test-only commits

### Step 1: Test harness

* [x] Add **Vitest** + `@types/node` devDeps
* [x] Add `"test": "vitest run"` and `"test:watch": "vitest"` to `package.json`
* [x] Add `vitest.config.ts` — include `src/`, `lib/`, `test/`; exclude `manuals/`, live queue paths
* [x] Extend `tsconfig.json` if needed: `"allowJs": true` for `src/` importing `lib/*.js`; add `scripts/*.ts` to typecheck scope or document exclusion
* [x] Yarn 4 uses `nodeLinker: node-modules` (`.yarnrc.yml`) — standard Vitest setup should work
* [x] Add `test/fixtures/` per `schemas.md` (minimal-queue, capture-gaps matrix cases, minimal-manual-tree)
* [x] Document in `docs/reference/schemas.md` fixture file names once created

### Step 2: Capture-gaps contract (P0)

* [x] Extract `isBlockingGap`, `blockingGaps`, `isHybridCompleteEligible`, `hasQueueBlockingGaps` to `lib/capture-gaps-rules.js` (pure)
* [x] Table-driven tests covering full matrix in `schemas.md` + hybrid-complete edge cases
* [x] Update `scripts/capture-gaps-lib.js` to `require('../lib/capture-gaps-rules')` for classification (keep fs I/O in lib wrapper)
* [x] Update `scripts/capture-gaps-backfill-lib.js` merge filter to use same rules (duplicate `log-backfill` filter today at line ~263)
* [x] Update `src/captureGaps.ts` to use same rules (import compiled JS or duplicate-free TS port verified by same tests)
* [x] Remove drift documented in `schemas.md` "Known drift" section when aligned

### Step 3: Path-resolve consolidation

* [x] Merge `src/pathResolve.ts` + `scripts/path-resolve-lib.js` → single `lib/path-resolve.js` (or TS compiled to `lib/`)
* [x] TS download code imports from shared module
* [x] JS scripts (`capture-gaps-backfill-lib.js`, audits) import from shared module
* [x] Tests: `pathColonDashVariants`, `fileExistsAtRelPath` with fixture dirs

### Step 4: Lock and queue unit tests

* [x] `scripts/bulk-lock.js` — acquire, release, stale PID, holder mismatch (temp `logs/` under `test/fixtures`)
* [x] `scripts/cdp-chrome-lock.js` — same pattern
* [x] `scripts/queue-lib.js` — `queueRank`, tier boost, `needs_params` exclusion, `isStaleIncomplete` with fixture gaps
* [x] `src/httpRetry.ts` — retryable vs non-retryable errors

### Step 5: Verify-download integration tests

* [x] `scripts/verify-download-lib.js` — temp dir fixtures: complete vs incomplete vs too-few-PDFs
* [x] Uses shared capture-gaps rules for gap blocking
* [x] (Optional) `scripts/patch-queue.js` — atomic write under concurrent read simulation

### Step 6: CI (fork only)

* [x] `.github/workflows/test.yml` — `yarn install`, `yarn test`, `npx tsc --noEmit`
* [x] No Playwright install, no PTS secrets, no live CDP

### Step 7: Optional small fix (if in scope)

* [x] `bulk-download.sh`: add `CIRCUIT_BREAKER_BACKOFF_SEC="${CIRCUIT_BREAKER_BACKOFF_SEC:-600}"` (documented in `env_vars.md` but missing assignment)

## ✅ Verification & Definition of Done

* [x] `yarn test` passes locally
* [x] All `schemas.md` blocking matrix rows have at least one test
* [x] `captureGaps.ts` and `capture-gaps-lib.js` agree on hybrid-complete for fixture with orphan `log-backfill`
* [x] `npx tsc --noEmit` passes
* [ ] CI green on fork (after push)
* [x] No changes to `templates/vehicles.json` or operator `manuals/` during tests
* [x] Update `schemas.md` — remove "Known drift" when fixed
* [x] Update context assessment Phase B checkboxes

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wrong gap merge breaks reconcile vs `yarn start` | **High** | Parity tests before merge; JS queue path is canonical |
| Path-resolve regression | **Medium** | Fixture trees; audit scripts use same module |
| Accidental bulk restart | Low | No orchestrator changes in this guide |
| Vitest + Yarn 4 PnP issues | Low | `nodeLinker: node-modules` already set in `.yarnrc.yml` |

**Rollback:** Revert commit; bulk unaffected if not restarted.

**Safe during subscription:** Yes, if behavior-preserving and tests prove parity.

---

**Status:** **Executed** (2026-07-08)  
**Depends on:** Dev Guide 01 (executed), Tom approval on schemas  
**Blocks:** Dev Guide 03

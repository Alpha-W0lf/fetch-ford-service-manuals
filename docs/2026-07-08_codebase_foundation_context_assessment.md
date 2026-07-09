# Codebase Foundation Context Assessment

**Date:** 2026-07-08  
**Author:** AI session (Tom-directed)  
**Status:** Context gathering complete · Dev Guides **01–03 executed** · Guides **04–06 plans only**  
**Next step:** Dev Guide 04 when bulk stopped (operator confirmation)

**Workflow position:** Phase 5 output from `meta_context_gathering.md` — foundation hardening initiative (not a Jira ticket).

**Related docs:**
- `AGENTS.md` — current agent invariants
- `docs/2026-07-08_pipeline_inventory_and_action_items.md` — operational open items
- `docs/pipeline-scheduling.md` — process coordination
- `second_brain/docs/guides/prompt_work_session_standards.md` — session standards
- `second_brain/docs/guides/best_practices_ai_native_engineering.md` — guardrails philosophy

---

## Work Item Overview

**Problem:** The fork grew from a single-vehicle upstream tool into a multi-process bulk pipeline (**~295 vehicles** after base queue + catalog expansion append, parallel workers, CDP param capture, locks, gap registry, audits) in roughly one intensive day. Progress is now unstable: CDP lock contention, operational whack-a-mole, and low confidence when changing orchestration code.

**Goal:** Pause feature/ops patches. Assess foundation quality. Plan structured improvements (architecture, modularity, tests, docs) before more enhancements.

**Out of scope (this initiative):**
- Adding vehicles to the queue
- Subscription-window throughput optimizations unrelated to foundation
- Rewriting download logic against Ford APIs without a dev guide

**In scope:**
- Honest quality assessment
- Identified strengths and weaknesses
- Phased improvement plan
- Test strategy (quality over coverage %)
- Dev guide topics for subsequent implementation

---

## Acceptance Criteria (Foundation Initiative)

Foundation work is successful when:

- [ ] **Architecture is documented** in one canonical doc (components, locks, state machine, blessed start paths)
- [ ] **Orchestration complexity is bounded** — no single file >400 lines without explicit justification; bash hot path split or wrapped in tested Node
- [ ] **No critical logic duplicated** across TS/JS pairs without a single source of truth
- [ ] **CDP coordination is predictable** — lock scopes documented and tested; capture and bulk do not deadlock or starve each other
- [ ] **Automated tests exist** for queue, locks, verify/reconcile, and path resolution (pure functions first)
- [ ] **Regression confidence** — a contributor can change lock or queue code and know within minutes if behavior broke
- [ ] **Ops docs match code** — `AGENTS.md`, `BULK_DOWNLOAD_GUIDE.md`, `pipeline-scheduling.md` stay aligned after refactors

---

## Codebase Size & Complexity

| Metric | Value | Assessment |
|--------|-------|------------|
| TS + JS + shell files | **75** | Small in file count |
| Total lines (tracked TS/JS/sh) | **8,788** (`git ls-files` sum, pass 3) | Moderate |
| Largest files | `capture-params.ts` (**883**), `bulk-download.sh` (**504**), `index.ts` (**383**) | **Oversized** — exceed 300-line maintainability target |
| `scripts/` files | **40** | **High ops surface area** relative to core `src/` |
| `src/` TS files | **30** | Reasonable domain split (workshop / wiring / pre-2003) |
| Test files | **0** formal (`*.test.*`, `*.spec.*`) | Critical gap |
| CI workflows | **0** (only `.github/FUNDING.yml`) | No automated gate |
| `package.json` test script | **None** | No `yarn test` entry point |
| Docs in `docs/` | **3** (+ root `AGENTS.md`, `BULK_DOWNLOAD_GUIDE.md`, `README.md`, etc.) | Thin for system complexity |
| Git commits | **82** total; **25 on 2026-07-08 alone** | Rapid ops-layer growth |
| Languages in repo | TypeScript, JavaScript, bash, **Python** (`import-dealerconnection-cookie.py`) | Mixed ops surface |

### Complexity verdict

The codebase is **not large by industry standards**, but it is **disproportionately complex for its size** because:

1. **Three runtime modes** interact: headless Playwright, live Chrome CDP, and bash orchestration.
2. **Two languages** (TypeScript + bash + ad hoc Node scripts) implement overlapping concerns.
3. **Filesystem-backed state** (`vehicles.json`, `capture-gaps.json`, lock dirs) has **layered** write safety: `lib/patch-queue.js` (mkdir lock + atomic tmp+rename) serializes per-vehicle status from bulk and capture; **whole-file rewrites** still used by `reconcile-queue.js`, `backfill-capture-gaps.js`, `generate-vehicle-queue.js`, `append-vehicle-queue.js` — run reconcile only when workers idle (bulk already does this).
4. **No automated safety net** — every fix is validated only by a live 72-hour subscription run.

**Maintaining and implementing high-confidence fixes is getting harder**, not because `src/wiring/` is unmaintainable, but because **orchestration + concurrency + CDP coordination** were added quickly without tests or a single architectural document.

---

## Architecture Snapshot

```
                    ┌─────────────────────────────────────┐
                    │  Terminal.app (blessed supervisor)   │
                    └──────────────┬──────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
  bulk-download.sh          capture-params.ts        PTS Chrome :9222
  (bash orchestrator)       (CDP param capture)       (live session)
          │                        │
          │ PARALLEL yarn start    │ acquires cdp-chrome.lock
          ▼                        ▼
  src/index.ts              vehicles/*/params.json
  workshop → wiring →       templates/vehicles.json
  connectors (CDP)                 │
          │                        │
          └───────────┬────────────┘
                      ▼
              manuals/<vehicle>/
              capture-gaps.json
```

**State stores:**
- `templates/vehicles.json` — queue (gitignored; source of truth for bulk)
- `manuals/<id>/` — downloaded artifacts
- `vehicles/<id>/params.json` — PTS API parameters
- `logs/*.lock/` — bulk + CDP mutexes
- Per-vehicle `capture-gaps.json`

---

## What Is Strong

### 1. Core download domain (`src/`)

- Clear separation: `workshop/`, `wiring/`, `pre-2003/`
- `index.ts` orchestrates a single vehicle job in understandable phases
- HTTP retry layer (`httpRetry.ts`) added with clear scope
- Gap registry concept (`captureGaps.ts`) supports resume and hybrid-complete
- CDP connector path (`cdpConnectorPage.ts`) solves real auth problems vs headless cookies

### 2. Operational learning captured in docs

- `AGENTS.md` documents real failures (Cursor shell kills bulk, flock on macOS)
- `BULK_DOWNLOAD_GUIDE.md` and `pipeline-scheduling.md` exist
- `2026-07-08_pipeline_inventory_and_action_items.md` records root causes honestly

### 3. Queue and verification primitives (conceptually sound)

- `queue-lib.js` — priority ranking with tier boost
- `verify-download-lib.js` + `reconcile-queue.js` — disk truth vs queue status
- `patch-queue.js` — atomic single-vehicle updates (avoids whole-file races from capture)
- `append-vehicle-queue.js` vs `generate-vehicle-queue.js` — safe vs destructive queue mutation documented

### 4. Integrity tooling (read-only audits)

- `audit-pdf-integrity.js`, `audit-capture-gaps.js`, `audit-duplicate-trees.js`
- These reflect mature ops thinking about fleet-scale downloads

### 5. Upstream core is stable

- Original single-vehicle flow (`yarn start` + params.json) still works
- `strict: true` TypeScript, Playwright, axios — sensible stack

---

## What Is Weak

### 1. Orchestration layer sprawl (highest risk)

| Issue | Evidence |
|-------|----------|
| **504-line bash orchestrator** | `scripts/bulk-download.sh` — circuit breaker, cookies, parallel workers, audits, reconcile |
| **883-line capture script** | `scripts/capture-params.ts` — CLI, CDP, PTS navigation, network intercept, queue patch, lock, recovery |
| **Multiple overlapping launchers** | `start-bulk-in-terminal.sh`, `start-bulk-download.sh`, `ensure-bulk-running.sh`, watchdog |
| **Rapid patches during live run** | CDP yield, prune safety, per-connector lock — correct direction but added under pressure |

**Impact:** Hard to reason about lock lifetime, failure modes, and restart behavior. Changes require live PTS Chrome to validate.

### 2. TypeScript / JavaScript duplication (with contract drift)

| TS | JS | Sync status | Risk |
|----|-----|-------------|------|
| `src/pathResolve.ts` (70 lines) | `scripts/path-resolve-lib.js` (132 lines) | **Explicit** "keep in sync" comment | Path bugs → wrong gap audits / verify |
| `src/captureGaps.ts` (208 lines) | `scripts/capture-gaps-lib.js` (157 lines) | **Implicit** — no sync comment; parallel implementations | Queue vs download disagree on complete |
| Lock acquire/release | `bulk-lock.js`, `cdp-chrome-lock.js` | Copy-paste pattern | Drift in stale-PID handling |
| Gap backfill | `capture-gaps-backfill-lib.js` (separate) | Third related module; filters orphan `log-backfill` on merge |

**Verified contract mismatch (not hypothetical):**

- `capture-gaps-lib.js` treats `log-backfill` gaps **without** `expectedFile` as **non-blocking** (`isBlockingGap`).
- `src/captureGaps.ts` `hasBlockingGaps()` only excludes `toc-audit` — it does **not** apply the `log-backfill` rule.
- **Hybrid-complete eligibility diverges too:** TS `isHybridCompleteEligible` counts all non-`toc-audit` gaps toward the max-gap threshold; JS uses `blockingGaps()` first — so orphan `log-backfill` rows can block hybrid complete in download but not in queue.
- **Effect:** `yarn start` may exit as incomplete while `reconcile-queue.js` / bulk marks the vehicle complete (or vice versa) for the same `capture-gaps.json`.

**Impact:** Fixes in one language may not propagate; queue status and download exit code can diverge. **Consolidation + contract tests are P0 for Phase B**, not optional cleanup.

**Dependency asymmetry (pass 4 — verified):** Bulk/reconcile/verify paths all call **`capture-gaps-lib.js` (JS)**:

- `scripts/verify-download-lib.js` → `hasCaptureGaps` / `captureGapCount`
- `scripts/reconcile-queue.js` → same
- `scripts/bulk-download.sh` (inline `node -e`) → same

Only **`yarn start` / `src/index.ts`** uses **`src/captureGaps.ts` (TS)** for exit status and gap recording during download.

**Recommended canonical semantics for Dev Guide 01:** Treat **JS `capture-gaps-lib` blocking rules** as queue truth (bulk fleet behavior). Align TS `CaptureGaps` to match — do not invert without explicit ops reason.

### 3. No automated test suite

- Zero `*.test.ts` / `*.spec.ts` files
- "Tests" are smoke scripts (`test-connector-cookies.ts`, `probe-pts.ts`) requiring live PTS
- `audit-pdf-integrity.js` is a batch script, not a regression harness

**Impact:** Every orchestration change is validated only by multi-hour live runs. This directly caused today's instability pattern: fix A breaks B; discover hours later.

### 4. CDP coordination is implicit, not modeled

Recent session proved:

- Session-long lock hold starves param capture for 10+ minutes
- Param capture holding lock during PTS reset blocks bulk connectors
- Prune during active connector job closed live tab
- Headless fallback when `:9222` is up produces silent low-quality capture

**Impact:** Two pipelines share one Chrome instance with filesystem locks — a **distributed systems problem** solved ad hoc.

### 5. Documentation drift (partially addressed by Guide 01)

- `README.md` still describes upstream DevTools single-vehicle workflow — **open**
- ~~`BULK_DOWNLOAD_GUIDE.md` fleet size~~ — **fixed** (~295)
- ~~`pipeline-scheduling.md` CDP lock~~ — **fixed** (per-connector + yield)
- ~~No `docs/dev_guides/` or `docs/reference/`~~ — **fixed** (Guide 01 executed; Guides 02–06 plans in `docs/dev_guides/`)
- Remaining risk: operator docs must **link** to reference, not re-copy lock rules (`PIPELINE_OPS.md` pattern)

### 6. `capture-params.ts` is a second application entry point

- Not in `src/`; mixes concerns that `index.ts` also touches (PTS auth, CDP, gaps)
- Pre-2003 capture not implemented; `--include-legacy` is a queue filter only
- Borderline vehicles (2003) fail intermittently

### 7. Bash + Node interop friction

- `bulk-download.sh` shells out to `node -e`, `npx ts-node`, `yarn start`
- Error propagation and logging split across tee, vehicle logs, orchestrator log
- macOS-specific assumptions (Terminal.app, launchd watchdog, no flock)

### 8. Tooling and quality gates

| Gap | Evidence |
|-----|----------|
| No test runner | `package.json` has no `test` script; no vitest/jest |
| No CI | No `.github/workflows/*` |
| `tsconfig.json` scope | Default includes `src/` only — **`scripts/*.ts` not type-checked by `tsc`** unless invoked via ts-node per file |
| Prettier scope | `"format": "prettier --write src/**/*.ts"` — **scripts excluded** |
| `dist/` gitignored | Compiled-output consolidation must use a **committed** path (e.g. `lib/` or shared `.js` with tests), not `dist/` |
| Runtime state gitignored | `templates/vehicles.json`, `manuals/`, `vehicles/*/params.json`, `templates/cookieString.txt` — tests **must** use temp fixtures, never mutate operator queue |

### 9. Auth / cookie path (under-documented in architecture)

- Headless workshop/wiring depend on `templates/cookieString.txt` exported from live PTS Chrome
- `export-cookies-from-chrome.js`, `cookie-refresh-loop.sh`, bulk's `COOKIE_REFRESH_MIN` — three related paths
- `test-connector-cookies.ts` is a **live** preflight, not a unit test
- Cookie staleness + `subscriptionExpired` recovery (`ptsAuth.ts`, `recover-pts-chrome-session.js`) are production-critical but not modeled in one doc

### 10. Documentation fragmentation risk

Truth is split across `AGENTS.md`, `BULK_DOWNLOAD_GUIDE.md`, `docs/pipeline-scheduling.md`, `docs/2026-07-08_pipeline_inventory_and_action_items.md`, and inline comments. **Dev Guide 01 must define a single canonical architecture doc** and demote others to "operator summary" + links — not add a fifth parallel source.

`docs/2026-07-08_pipeline_inventory_and_action_items.md` is **stale on CDP** (checkpoint ~19:00; does not document per-connector lock scope, capture yield/defer, or prune incident). Update during Phase A, not during code refactors.

---

## What Makes Progress Difficult Right Now

| Factor | How it manifests |
|--------|------------------|
| **Live subscription pressure** | Patches land during 72h window; no time to refactor |
| **No tests** | Lock/CDP/queue changes are high-risk |
| **Shared Chrome** | Capture and bulk are coupled by CDP mutex + browser state |
| **Filesystem queue races** | Mitigated: `patch-queue` serializes patches; reconcile/backfill still rewrite full JSON when workers idle |
| **AI-assisted rapid growth** | 25 commits/day added ops features faster than architecture absorbed |
| **Oversized files** | Hard for humans and agents to edit without unintended side effects |
| **Implicit state machine** | `vehicles.json` statuses (`needs_params`, `pending`, `downloading`, `incomplete`, `failed`, `complete`) — rules spread across `bulk-download.sh`, `reconcile-queue.js`, `queue-lib.js`, `patch-queue.js`, `backfill-capture-gaps.js` |
| **Contract drift** | `captureGaps.ts` vs `capture-gaps-lib.js` blocking rules differ (see §2) |

### Queue status state machine (scattered — must be canonical in Dev Guide 01)

| Status | Set by | Cleared / transitions to |
|--------|--------|---------------------------|
| `needs_params` | Queue generation / expansion | `patch-queue.js` → `pending` after capture |
| `pending` | Reconcile, capture, build-params | `downloading` (bulk worker start) |
| `downloading` | `bulk-download.sh` | `complete` / `incomplete` / `failed` / back to `pending` (reconcile) |
| `incomplete` | Bulk on partial success, reconcile on gaps | `complete` when disk + gaps OK |
| `failed` | Bulk on hard failure | Retry via queue rank; may become `pending` |
| `complete` | Bulk, reconcile, backfill | `incomplete` if gaps reappear or disk incomplete |
| `skip` | `generate-vehicle-queue.js` | Excluded from bulk selection (`isQueued` returns false) |

**Queue size (verified):** base generator ~186 + `vehicle-catalog-expansion.js` **109** append-only vehicles = **~295** fleet. Inventory checkpoint sums to **294** statuses (56+54+181+1+2) — consistent.

No single enum or module owns these transitions — **high blast-radius risk** when editing any one script.

---

## Honest Quality Scores

Scores are for **maintainability + confidence to change**, not "does it download PDFs when babysat."

| Area | Score (1–10) | Notes |
|------|:------------:|-------|
| **Core single-vehicle download (`src/`)** | **7** | Solid domain layout; `index.ts` getting heavy |
| **Bulk orchestration (`bulk-download.sh` + friends)** | **4** | Works when supervised; fragile; untested |
| **Param capture (`capture-params.ts`)** | **4** | Powerful but monolithic; CDP coupling painful |
| **Queue / verify / reconcile libs** | **6** | Good ideas; need tests + schema |
| **Documentation (ops)** | **7** | Reference + PIPELINE_OPS added; inventory may lag live pipeline |
| **Documentation (dev/onboarding)** | **6** | Dev guides 01–06 exist; README upstream-centric |
| **Test infrastructure** | **7** | Vitest + 44 tests; gaps, locks, patch-queue serialization, queue stale rank |
| **Modularity / DRY** | **5** | TS/JS duplication; script sprawl |
| **Simplicity** | **5** | Many scripts; overlapping launch paths |
| **Extensibility (pre-2003, new vehicle types)** | **4** | Pre-2003 not automated; matchers ad hoc |
| **Overall foundation readiness** | **7** | **Guide 02 executed; 33 unit tests; runtime ~6.5 until Guide 03–04** |

**Summary:** The project is **good at accomplishing the mission under supervision** and **mediocre as a codebase you can evolve safely**. That gap is exactly what this initiative should close.

---

## Should We Build a Test Suite?

**Yes — but not "tests for coverage."** Follow TDAD / purposeful testing from `best_practices_ai_native_engineering.md` and adapt Python testing tiers to Node.

### Why tests are justified now

1. **Pure logic exists** that does not need PTS: queue ranking, lock acquire/release/stale, path colon-dash variants, verify-download status, gap classification.
2. **Regressions are expensive** — a bad lock change costs hours of subscription time.
3. **Complexity is in coordination**, not Ford API shape — unit tests on coordination primitives give high ROI.
4. **Agents will keep editing this repo** — without tests, instruction drift → repeated whack-a-mole.

### What NOT to do

- Do not add Playwright E2E against live PTS as the first test layer
- Do not chase 80% line coverage on `capture-params.ts`
- Do not mock entire Ford CDN and call it done

### Recommended test pyramid (for this repo)

| Tier | Target | Examples | Runner |
|------|--------|----------|--------|
| **Unit** | Pure functions, no I/O | `queueRank`, `pathColonDashVariants`, `isRetryableHttpError`, lock stale PID logic | `node:test` or **Vitest** |
| **Integration** | Temp dirs + fake queue JSON | `reconcile-queue` status transitions, `verify-download-lib` on fixture tree, `patch-queue` atomic write | Vitest + `fs.mkdtemp` |
| **Contract** | JSON schemas | `vehicles.json` entry shape, `capture-gaps.json` entry shape | zod or ajv in tests |
| **Smoke (manual/CI opt-in)** | Live PTS | `test-connector-cookies.ts`, `probe-pts.ts` | Separate CI job, not blocking unit suite |

### Priority test targets (Phase 1)

1. `scripts/cdp-chrome-lock.js` — acquire, release, stale cleanup, holder mismatch
2. `scripts/bulk-lock.js` — same
3. `scripts/queue-lib.js` — tier boost, rank ordering, `needs_params` exclusion
4. `scripts/verify-download-lib.js` — complete vs incomplete vs failed
5. `scripts/path-resolve-lib.js` / `pathResolve.ts` — **consolidate first**, then test once
6. `scripts/capture-gaps-lib.js` — hybrid complete, blocking vs informational gaps
7. `src/httpRetry.ts` — retryable vs non-retryable errors

### Priority test targets (Phase 2)

- `patch-queue.js` + concurrent write simulation
- CDP lock + capture yield/defer behavior (mock lock module)
- Param capture `modelMatchers()` — table-driven tests for PTS aliases

---

## Improvement Roadmap (Phases — Planning Only)

Aligned with `prompt_work_session_standards.md`: **no implementation until dev guides exist.**

### Phase A — Document & freeze invariants (1 session)

- [x] Write `docs/reference/architecture.md` — components, locks, state machine diagram, blessed commands
- [x] Add `vehicles.json` + `capture-gaps.json` schema reference (`docs/reference/schemas.md`)
- [x] Consolidate launcher docs — `docs/PIPELINE_OPS.md` + updates to `BULK_DOWNLOAD_GUIDE.md`
- [x] Mark experimental paths (watchdog) as experimental in reference docs

**Dev guide:** `docs/dev_guides/2026-07-08_dev_guide_01_architecture_reference.md` — **executed**

### Phase B — Extract & test pure libs (2–3 sessions)

- [x] Introduce **Vitest** (recommended default: fixtures, TS-native, fast) or `node:test` + `yarn test`
- [x] **Fix capture-gaps contract first** — single source of truth; table-driven tests for blocking / hybrid-complete / `log-backfill` / `toc-audit`
- [x] Consolidate `path-resolve` — one module; scripts import via compiled `lib/` **or** shared tested `.js` that TS re-exports
- [x] Unit tests: locks, queue-lib, verify-download-lib, path-resolve, httpRetry
- [x] GitHub Actions on **origin fork only** — `yarn test` + `tsc --noEmit` (no PTS secrets, no Playwright install in CI initially)
- [x] Add `test/fixtures/` with minimal queue + manual tree samples (git-tracked)

**Do not:** emit to gitignored `dist/` without changing `.gitignore` strategy.

**Dev guide:** `docs/dev_guides/2026-07-08_dev_guide_02_test_harness_and_pure_libs.md` — **executed**

### Phase C — CDP coordination spec + lock tests (1 session)

- [x] Extract `lib/cdp-tab-hygiene.js` + `lib/cdp-capture-defer.js` (pure helpers from existing code)
- [x] Document lock scopes: per-connector (`withCdpChromeLock`), capture yield/defer, prune rules
- [x] Unit tests for defer policy, tab hygiene, CDP lock wait-after-release
- [x] `docs/reference/cdp_tab_hygiene.md`
- [x] Align `docs/pipeline-scheduling.md` with extracted helpers

**Dev guide:** `docs/dev_guides/2026-07-08_dev_guide_03_cdp_coordination.md` — **executed**

### Phase D — Orchestration refactor (after subscription or bulk idle)

- [ ] Split `bulk-download.sh` — Node orchestrator + thin bash wrapper for Terminal/caffeinate
- [ ] Split `capture-params.ts` — `src/capture/` module: navigation, intercept, lock policy, CLI
- [ ] Integration tests with fixture queue + mock CDP lock

**Dev guide candidate:** `docs/dev_guides/2026-07-08_dev_guide_04_orchestrator_split.md` — **plan only**

### Phase E — Capture modularization

- [ ] Extract capture modules without changing PTS navigation behavior
- [ ] Table-driven `modelMatchers` registry

**Dev guide candidate:** `docs/dev_guides/2026-07-08_dev_guide_05_capture_modularization.md` — **plan only**

### Phase F — Capture completeness (legacy)

- [ ] Pre-2003 automated branch in capture (not manual DevTools)
- [ ] Defer `<2003` until modern queue drained — policy in architecture doc

**Dev guide candidate:** `docs/dev_guides/2026-07-08_dev_guide_06_legacy_capture.md` — **plan only**

### Phase G — Hardening & cleanup

- [ ] Remove duplicate launch paths (watchdog demote or delete)
- [ ] **Extend** `pipeline-health.sh` (already exists) — merge overlapping checks from `queue-status.sh --health` where sensible; do not create a third health script
- [ ] Pre-commit: prettier (include `scripts/`), `tsc --noEmit`, unit tests
- [ ] Optional: file-size lint rule (>400 lines needs exemption comment)

---

## Blast Radius & Implementation Risk (by phase)

Per `meta_creating_dev_guides.md` — every dev guide must carry this; summarized here for planning.

| Phase | Touches | Blast radius | Safe during active bulk? | Rollback |
|-------|---------|--------------|--------------------------|----------|
| **A — Docs** | `docs/reference/`, inventory doc, cross-links | **Low** | **Yes** | Revert markdown |
| **B — Tests + lib consolidation** | `captureGaps`, path-resolve, `package.json`, new `test/` | **Medium** — wrong merge breaks reconcile vs download | **Yes** if behavior-preserving + tests prove parity | Revert commit; bulk unaffected if not restarted |
| **C — CDP coordination tests** | `cdp-chrome-lock.js`, CDP docs | **Medium** — lock semantics | **Yes** | Revert commit |
| **D — Orchestrator split** | `bulk-download.sh`, capture-params, start scripts | **Very high** — can stop fleet | **No** | Restore bash from git; restart Terminal |
| **E — Capture modularization** | `capture-params.ts` structure | **Medium–high** | **After capture restart** | Revert; restart capture |
| **F — Pre-2003 capture** | `capture-params.ts`, `src/pre-2003/` | **Medium** — new PTS navigation paths | **After capture restart only** | Feature flag / branch |
| **G — Cleanup** | Launchers, pre-commit | **Low–medium** | Mostly yes | Revert hooks |

**Highest-risk mistake:** Refactoring orchestration or lock semantics during a live subscription run without tests. **AGENTS.md invariant #5** aligns with this.

**Subscription coexistence policy (recommended default):**

| Change type | During subscription |
|-------------|---------------------|
| Docs (Phase A) | Allowed |
| Unit tests + pure lib consolidation (Phase B) | Allowed if parity tests pass; **do not restart bulk** for doc/test-only |
| Critical ops bugfix (CDP deadlock, supervision) | Allowed — smallest fix + commit; still no orchestrator rewrite |
| Orchestrator split (Phase D) | **Blocked until bulk stops** |

---

## Knowledge Status

### Known (verified — pass 2)

1. **75** tracked TS/JS/sh files; **8,788** lines; largest: `capture-params.ts` (883), `bulk-download.sh` (504)
2. Zero formal automated tests; no CI workflows; no `yarn test`
3. CDP lock contention is a primary stability bottleneck; per-connector lock + capture yield pushed 2026-07-08 (`a80eb6a`…`5cec128`)
4. Path-resolve has explicit sync comment; capture-gaps has **parallel logic with verified drift** on `log-backfill` blocking rules
5. Bulk requires Terminal.app supervision — `AGENTS.md`
6. 25 commits on 2026-07-08; 82 total
7. `pipeline-health.sh` already exists (Phase E should extend, not replace)
8. Gitignored operator state: queue, manuals, params, cookies — tests must use fixtures

### Assumed (defaults for dev guides unless Tom overrides)

| Item | Recommended default |
|------|---------------------|
| Test runner | **Vitest** + `yarn test` |
| Orchestrator direction | **Node-first orchestrator, thin bash wrapper** for Terminal/caffeinate (Phase C) |
| Package layout | Move capture logic to `src/capture/` in Phase C; not in Dev Guide 01 |
| CI | GitHub Actions on fork: `yarn test` + `tsc --noEmit` only |
| Ops patches during foundation | **Critical fixes only**; no Phase C during subscription |
| Shared lib output path | `lib/` (committed) or test-first `.js` in `scripts/` — not gitignored `dist/` |

### Unknown (low blocker count — 2 remain)

1. **Watchdog:** Finish (FDA / launcher) vs remove post-subscription? *(Does not block Dev Guide 01)*
2. **Tier-1 incomplete policy:** Always gap-retry vs accept `incomplete` and move on? *(Ops policy; document in architecture, not blocking tests)*

**Decision tree (`meta_context_gathering.md`):** Acceptance criteria clear ✅ · Critical unknowns <3 ✅ · Infrastructure N/A ✅ · Patterns identified ✅ → **ready for dev guide authoring**.

---

## Readiness Assessment

| Question | Answer |
|----------|--------|
| Ready to implement foundation fixes? | **No** — dev guides first |
| Ready to author dev guides? | **Done** — 01 executed; **02–06 authored as plans** |
| Ready to implement Guide 02? | **Done** — executed 2026-07-08 |
| Ready to implement Guide 03? | **Yes** — after push / CI verify |
| Blocked? | **No** — recommended defaults documented; Tom can override in Dev Guide 01 preflight |
| Can subscription bulk continue during Phase A? | **Yes** — docs only |
| Can subscription bulk continue during Phase D? | **Only when bulk stopped** |

---

## Suggested Dev Guide Sequence

See **`docs/dev_guides/README.md`** for index and workflow (guide vs execution).

| # | Title | Type | Status |
|---|-------|------|--------|
| 01 | Architecture reference | Docs | **Executed** |
| 02 | Test harness + pure libs | Code + tests | **Executed** |
| 03 | CDP coordination tests | Code + tests | Plan only |
| 04 | Bulk orchestrator split | Major refactor | Plan only (bulk stopped) |
| 05 | Capture modularization | Refactor | Plan only |
| 06 | Pre-2003 capture | Feature | Plan only |

**Dev Guide 01 deliverables (specific):**

- `docs/reference/architecture.md` — canonical system diagram, locks, cookie flow, blessed commands
- `docs/reference/queue_state_machine.md` — status transitions table (expand § above)
- `docs/reference/schemas.md` — `vehicles.json` entry, `capture-gaps.json` gap shape
- `docs/reference/env_vars.md` — CDP, HTTP retry, hybrid-complete, bulk maintenance env catalog (scattered today across 10+ files)
- Update `docs/2026-07-08_pipeline_inventory_and_action_items.md` CDP section (per-connector lock, yield, prune lesson)
- Update `docs/pipeline-scheduling.md` CDP lock scope to match `src/cdpConnectorPage.ts` + `capture-params.ts`
- Fix `BULK_DOWNLOAD_GUIDE.md` fleet size (186 → ~295) and link to architecture reference
- Cross-link from `AGENTS.md` → reference (keep invariants short; no duplicate prose)
- Seed `test/fixtures/` from `templates/vehicles.example.json` pattern (Dev Guide 02, but specify shape in schemas now)

---

## Implementation readiness (stop planning here)

| Gate | Status |
|------|--------|
| Context assessment | ✅ Complete (pass 4 + guide authoring) |
| Dev Guide 01 | ✅ Executed |
| Dev Guides 02–06 | ✅ Plans authored (`docs/dev_guides/README.md`) |
| `schemas.md` blocking matrix | ⏳ **Tom approval required** |
| Explicit "follow dev guide 02" | ⏳ Required before any code |
| Guides 03–06 implementation | ❌ Not until prior guide done + go-ahead |

**No further context or dev-guide planning passes needed** unless live pipeline checkpoint or schema disagreement.

---

From `meta_context_gathering.md` + session evidence:

- ❌ Refactor `bulk-download.sh` during active bulk run
- ❌ Add more lock types without tests
- ❌ Add tests that require live PTS to get green CI
- ❌ Split files without moving behavior (cosmetic churn)
- ❌ Manual DevTools workflow for pre-2003 (policy: automate eventually)
- ❌ Another launcher script without removing an old one

---

## Pass 4 Review Notes (2026-07-08)

**Pass 3 accuracy:** ~98% — one structural gap in roadmap vs dev-guide sequence.

**Corrections applied:**

- **Roadmap phases renumbered C–G** to align 1:1 with Dev Guides 03–06 + cleanup (pass 3 had Phase C = orchestrator while Guide 03 = CDP — a planning bug)
- **Dependency asymmetry:** bulk/reconcile/verify use JS gap lib; only `yarn start` uses TS — canonical semantics should follow JS for queue truth
- **Base fleet 186** verified by running `generate-vehicle-queue.js` (186 + 109 expansion = 295)
- Blast-radius table expanded for CDP (C), capture modularization (E), legacy (F)

**Deliberate stop:** Further context passes will yield diminishing returns. Remaining work is **authoring**, not more assessment.

**Repo note:** This context file is still **untracked** (`??` in `git status`) — commit when ready alongside Dev Guide 01.

---

## Pass 3 Review Notes (2026-07-08)

**Pass 2 accuracy:** ~95% — pass 3 found numbering inconsistencies and a few stale-doc references, not structural gaps.

**Corrections applied:**

- LOC: ~8,258 → **8,788** (tracked files via `git ls-files`)
- Fleet size: verified **186 base + 109 expansion ≈ 295**; `BULK_DOWNLOAD_GUIDE.md` still says 186
- Queue writes: clarified **patch-queue** (bulk + capture) vs whole-file (reconcile/backfill/generate)
- State machine: added **`skip`** status
- Contract drift: added **hybrid-complete** divergence (not just `hasBlockingGaps`)
- Dev guide roadmap: fixed **Phase C/D guide numbers** to match sequence table (was 03/04, now 04/06)
- Dev Guide 01 deliverables: `env_vars.md`, `pipeline-scheduling` CDP update, `BULK_DOWNLOAD_GUIDE` fleet count

**Not added (intentionally):**

- Live pipeline health snapshot (operator task; inventory doc has last checkpoint)
- Upstream merge/rebase strategy (out of foundation scope)
- TypeScript upgrade (4.6 → latest) — separate initiative

**Honest readiness after pass 3:** Context is **complete for Dev Guide 01**. A fourth pass is **not warranted** unless you want a fresh live pipeline checkpoint merged into the inventory doc. Proceed to dev guide authoring.

---

## Changelog

| Date | Update |
|------|--------|
| 2026-07-08 | Initial foundation context assessment |
| 2026-07-08 | Pass 2 — verified metrics, contract drift, blast radius, dev guide 01 deliverables |
| 2026-07-08 | Pass 4 — roadmap/guide alignment, JS/TS gap asymmetry, 186 base verified, stop gate |
| 2026-07-08 | Dev guides 02–06 plans authored; Guide 01 = executed; workflow clarified |

---
status: Ready
artifact_type: dev-guide
context_summary: docs/dev_guides/2026-07-10_dev_guide_04_4_priority_family_failure_context.md
plan_package: docs/dev_guides/2026-07-10_plan_package_04_4_priority_family_failure_policy.md
depends_on: docs/dev_guides/2026-07-09_dev_guide_04_3_incomplete_retry_storm.md
pass: 2
readiness_score: 93
last_solidify: 2026-07-10
---

# Dev Guide 04.4: Priority-family partial-failure policy

## 🎯 Objective

Stop expensive in-worker auth iteration and opaque partial **FAIL** exits for priority-family vehicles while preserving ~15.6k reusable partial PDFs — by recording structured gaps, exiting intentionally as `incomplete`, and reusing the Guide 04.3 per-vehicle cooldown (with auth-budget-stop extension).

## 📚 Critical Context & References

> **CRITICAL:** Read before implementation. **Guide 04.3 must be committed first.**

* **Context summary:** [2026-07-10_dev_guide_04_4_priority_family_failure_context.md](./2026-07-10_dev_guide_04_4_priority_family_failure_context.md)
* **Combined sequence:** [2026-07-10_combined_sequence_04_3_04_4.md](./2026-07-10_combined_sequence_04_3_04_4.md)
* **Prerequisite guide:** [2026-07-09_dev_guide_04_3_incomplete_retry_storm.md](./2026-07-09_dev_guide_04_3_incomplete_retry_storm.md) — `lib/vehicle-cooldown.js` must exist
* **Issue registry:** [../known_issues_and_backlog.md](../known_issues_and_backlog.md) — SEC-01, RUN-05, REL-08 follow-on
* **Queue policy:** `scripts/queue-lib.js` — `isQueued`, `queueRank`, `isStaleIncomplete`
* **Worker entry:** `src/index.ts`, `src/workshop/saveEntireManual.ts`, `src/workshop/fetchTreeAndCover.ts`, `src/wiring/fetchTableOfContents.ts`
* **Safe logging:** `src/logHttpError.ts`
* **Gap helpers:** `src/captureGaps.ts` — `workshopGapId`, `wiringPageGapId`, `gapReasonFromError`
* **Agent:** `AGENTS.md` — smallest correct change; bulk stopped for implementation
* **Execution workflow:** `second_brain/docs/guides/prompt_follow_dev_guide.md`

**Planning gate:** Documentation and unit-test design are safe anytime.  
**Implementation gate:** Guide **04.3 executed and tests green** + this plan package approved + bulk deliberately stopped.

**Subscription-lapsed note:** If PTS subscription is expired, live bulk restart has low throughput value until renewal. Implement 04.4 for hardening; run live repro matrix cases only when content access is confirmed live.

---

## Problem statement

| Path | Current behavior | Problem |
|------|------------------|---------|
| `saveEntireManual` + `ignoreSaveErrors` | Records each 403 gap, continues for hundreds of documents | Worker spends wall-clock on doomed auth iteration (`2017-navigator` 52 gap attempts) |
| `fetchTreeAndCover` in `modernWorkshop` | Uncaught throw → `process.exit(1)` | Zero-PDF vehicles stranded as `failed` (<50 PDFs not queueable) |
| `fetchTableOfContents` | Uncaught throw → `process.exit(1)` | Partial workshop preserved but wiring phase marks run `failed` |
| Partial auth + exit 1 | `runOne` → `failed` when ≥50 PDFs | Queueable `failed` re-dispatches (`2013-taurus` / `2014-fiesta` evening loop) |
| Workshop `console.error(e)` | Raw Axios object in logs | SEC-01 — session cookies in `logs/*.log` |

**04.3 does not fix these** — it fixes INCOMPLETE fast-auth storms, stream crash, and narrow wiring gaps only.

---

## Scope tiers

### Tier A — In scope (04.4 MVP)

| # | Deliverable |
|---|-------------|
| 1 | **Workshop auth-budget stop** — stop document loop after N consecutive auth-class failures |
| 2 | **TreeAndCover gap + graceful return** — `workshop:tree-and-cover` gap; worker exits 0 |
| 3 | **Wiring-TOC gap + graceful return** — `wiring-page:toc:<book>` gap; worker exits 0 |
| 4 | **Extend 04.3 cooldown** — `[auth-budget-stop]` incomplete outcomes bypass fast-fail runtime threshold |
| 5 | **SEC-01** — route workshop errors through `logHttpError()`; gap `error` field stores message only |
| 6 | **Tests** — auth budget, early-failure gaps, exit-0 incomplete classification, log redaction |

### Out of scope

- Global `queueRank` rewrite
- Generic FAIL-path cooldown without exit-0 incomplete conversion
- Second cooldown file or recovery-generation state machine
- Changing 04.2 hung-reap thresholds
- True subscription renewal / PTS account fixes
- Pre-2003 workshop paths (unless trivially shared — defer)

---

## 🏗️ Architectural pattern

> **Pattern:** Worker-local auth budget → structured gap → intentional exit 0 → orchestrator `incomplete` → 04.3 cooldown  
> **Constraint:** Never mark partial data `complete` to escape the queue

```text
auth-class error
  → captureGaps.record() (existing reason taxonomy)
  → consecutive auth counter in SaveOptions
  → [budget exceeded] log [auth-budget-stop]; break loop / return
  → index.ts completes → exit 0
  → runOne → INCOMPLETE + auth gaps
  → vehicle-cooldown.recordOutcome({ authBudgetStop: true })
```

### Frozen gap ID contracts

| Case | Gap ID | Expected file | Cooldown path |
|------|--------|---------------|---------------|
| TreeAndCover auth failure (zero PDFs) | `workshopGapId("tree-and-cover")` → `workshop:tree-and-cover` | `toc.json` | Usually fast (&lt;60s) → 04.3 fast-fail cooldown |
| Wiring TOC auth failure | `wiringPageGapId("toc", wiringParams.book)` → `wiring-page:toc:<book>` | `Wiring/toc.json` | Usually fast → 04.3 fast-fail cooldown; **no** `[auth-budget-stop]` marker |
| Workshop auth-budget stop (partial) | Existing per-document `workshop:*` gaps | per doc | Slow → `authBudgetStop: true` via `[auth-budget-stop]` log marker |

### Auth-class reason helper (worker)

Use one local helper (or shared export from `captureGaps.ts` if clean):

```typescript
function isAuthClassGapReason(reason: string): boolean {
  return reason === "auth" || reason === "subscription-expired";
}
```

**Important:** `maybeRefreshCookiesOnAuthStreak` today only counts `reason === "auth"` and **resets** the streak on `subscription-expired`. Auth-budget counting must use `isAuthClassGapReason`, not the refresh helper's narrower check.

### Edge cases (plan for in implementation)

| Edge case | Handling |
|-----------|----------|
| **Recursive `saveEntireManual`** | TOC subfolders recurse at line ~202. A `break` in an inner call does not stop outer loops. Use `SaveOptions.authBudgetStopRequested`: inner sets flag; outer checks after each recursive call and breaks. |
| **`subscription-expired` gaps** | Must increment auth-budget streak (same as `auth`). |
| **Wiring runs after workshop budget stop** | **MVP: allow wiring to run.** Partial vehicles often have `Wiring/toc.json` already; connector phase may still succeed after workshop auth burst. Do not skip wiring in MVP unless tests show repeated waste. |
| **TreeAndCover vs document-loop stop** | TreeAndCover catch is separate (Step 3); does not use `[auth-budget-stop]`. |
| **PtsAuthError exit 2** | Unchanged — outside MVP unless repro shows gapless storm. |

### Proposed env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `WORKSHOP_AUTH_REFRESH_THRESHOLD` | `5` | **Existing** — one cookie-file refresh per run |
| `WORKSHOP_AUTH_STOP_THRESHOLD` | `10` | Consecutive auth-class failures before in-worker stop (must be **>** refresh threshold) |
| `WORKSHOP_AUTH_STOP_ENABLED` | `1` | Set `0` to disable budget stop (rollback without revert) |

---

## 📋 Implementation checklist

### Step 0: Prerequisite verification

* [x] Guide 04.3 is committed; `lib/vehicle-cooldown.js` exists and tests pass.
* [x] `yarn test` and `yarn typecheck` green before starting 04.4.

### Step 1: Tests first

* [x] Add `test/workshop-auth-budget.test.ts`: mock auth failures increment streak; `subscription-expired` counts toward stop; recursive nested TOC respects `authBudgetStopRequested`; stop at threshold; `[auth-budget-stop]` logged; gaps persisted; no throw.
* [x] Add `test/tree-and-cover-auth-gap.test.ts`: mocked `fetchTreeAndCover` 403 → `workshop:tree-and-cover` gap recorded; `modernWorkshop` returns without throw.
* [x] Add `test/wiring-toc-auth-gap.test.ts`: mocked `fetchTableOfContents` 403 → `wiring-page:toc:<book>` gap; no `process.exit(1)`.
* [x] Add `test/workshop-log-redaction.test.ts`: workshop catch path uses `logHttpError`; no `Cookie` in stdout.
* [x] Extend `test/bulk-orchestrator.test.ts`: exit-0 worker with auth gaps + `[auth-budget-stop]` in log → cooldown increments **without** sub-60s runtime.
* [x] Extend `test/vehicle-cooldown.test.ts`: `recordOutcome({ authBudgetStop: true })` bypasses fast-fail runtime check.
* [x] Run affected tests to establish expected failing behavior.

### Step 2: Workshop auth-budget stop

* [x] Add a local `isAuthClassReason(reason)` accepting `auth` and `subscription-expired` only (match 04.3 orchestrator predicate).
* [x] In `saveEntireManual.ts`, add `WORKSHOP_AUTH_STOP_THRESHOLD` (default 10, must be > `AUTH_REFRESH_THRESHOLD`).
* [x] Extend `SaveOptions` with `authBudgetStopRequested?: boolean`. Set it when the budget is exceeded.
* [x] Refactor streak tracking: count **auth-class** failures (`auth` + `subscription-expired`), not `reason === "auth"` only. Keep `maybeRefreshCookiesOnAuthStreak` refresh at the existing threshold but ensure `subscription-expired` increments the same streak used for stop.
* [x] After each auth-class gap record, if streak ≥ stop threshold: `console.log('[auth-budget-stop] …')`, set `options.authBudgetStopRequested = true`, `break` from the current loop.
* [x] **Recursive calls:** `saveEntireManual` is recursive for nested TOC folders (`saveEntireManual.ts` ~202–208). After each recursive call, if `options.authBudgetStopRequested`, break the parent loop too. At the top of each loop iteration, skip work when the flag is already set.
* [x] Do **not** throw `PtsAuthError` for budget stop — return normally so `index.ts` exits 0.
* [x] Non-auth reasons reset streak (existing behavior for non-auth in refresh helper).

**Edge case (MVP — accepted):** After workshop budget stop, `index.ts` may still run the wiring phase. This is intentional: partial vehicles often have `Wiring/toc.json` and may complete connectors while workshop auth is dead. Do not skip wiring in 04.4 unless a later repro proves it causes harm.

### Step 3: TreeAndCover early failure gap

* [x] In `modernWorkshop` (`src/jobHelpers.ts`), wrap `fetchTreeAndCover` in try/catch when toc/cover do not exist.
* [x] On auth-class error: `logHttpError`, record `workshopGapId("tree-and-cover")` with `expectedFile: "toc.json"`, return early (skip `saveEntireManual`).
* [x] Non-auth errors: rethrow (preserve existing fail behavior).

### Step 4: Wiring-TOC early failure gap

* [x] In `src/jobHelpers.ts` / `src/index.ts` wiring section, wrap `fetchTableOfContents` via `resolveWiringTableOfContents` when `Wiring/toc.json` absent.
* [x] On auth-class error: `logHttpError`, record `wiringPageGapId("toc", wiringParams.book)` with `expectedFile: "Wiring/toc.json"`, skip `saveEntireWiring` for full TOC fetch (connectors-only path unchanged).
* [x] Allow `run()` to complete → exit 0 with blocking gaps.

### Step 5: SEC-01 log redaction

* [x] Replace raw `console.error(..., e)` in `saveEntireManual.ts` catch paths (document loop **and** direct-PDF URL loop) with `logHttpError(e, context)`.
* [x] Store `error: e instanceof Error ? e.message : String(e)` in `captureGaps.record()` — never serialize full Axios error.

### Step 6: Extend 04.3 cooldown for auth-budget-stop

* [x] `recordOutcome` in `lib/vehicle-cooldown.js` already accepts `authBudgetStop` (forward-compatible API from 04.3); verify behavior unchanged.
* [x] In `runOne`, detect `[auth-budget-stop]` in vehicle log (after gap-reason classification) and pass `authBudgetStop: true` to `recordOutcome`.
* [x] Do not add FAIL-path cooldown — only exit-0 incomplete outcomes.

### Step 7: Complete tests and docs

* [x] All Step 1 tests green; no 04.2 / 04.3 regression.
* [x] `docs/reference/env_vars.md` — new stop threshold vars
* [x] `known_issues_and_backlog.md` — SEC-01 mitigated; add 04.4 executed note when done
* [x] `architecture.md` — auth-budget-stop paragraph

---

## ✅ Verification & definition of done

### Mock / unit verification (subscription lapsed OK)

* [x] Auth-budget stop fires at threshold; gaps persisted; worker would exit 0
* [x] TreeAndCover 403 produces `workshop:tree-and-cover` gap; no uncaught throw
* [x] Wiring TOC 403 produces `wiring-page:toc:<book>` gap; no exit 1
* [x] Cooldown increments on `[auth-budget-stop]` incomplete without 60s runtime
* [x] Workshop logs contain no cookie strings in redaction test
* [x] `yarn test` and `yarn typecheck` green

### Live verification (defer until subscription renewed)

* [ ] One zero-PDF TreeAndCover 403 vehicle → `incomplete` + gap (not stranded `failed`)
* [ ] One partial workshop vehicle with wiring TOC auth → `incomplete` + gap; PDFs preserved
* [ ] `connectorPreflight` success clears cooldowns after recovery
* [ ] Network failure (`ERR_INTERNET_DISCONNECTED`) does **not** trigger auth-budget stop

### Post-implementation ops

* [ ] `node scripts/reconcile-queue.js` + `./scripts/queue-status.sh --health`
* [ ] Blessed Terminal restart **only if** operator confirms subscription live or accepts auth-idle cycling with new protections

---

## ⚠️ Blast radius & risks

| Risk | Mitigation |
|------|------------|
| Stop threshold too low — leaves valuable pages | Default 10 (> refresh 5); env tunable |
| Recursive TOC folders continue after inner budget stop | `authBudgetStopRequested` on `SaveOptions`; parent loops check after recursive calls |
| `subscription-expired` not counted (today `maybeRefreshCookies` only tracks `auth`) | Shared `isAuthClassReason` for streak, refresh, and stop |
| Workshop stop then wiring runs into auth | Accepted MVP — wiring may still succeed when `Wiring/toc.json` exists |
| TreeAndCover catch masks non-auth bugs | Rethrow non-auth errors |
| Cooldown extension breaks 04.3 fast-fail semantics | `authBudgetStop` flag is explicit; 04.3 path unchanged |
| Subscription lapsed — restart produces all auth fails | Document; optional restart; cooldown protects slots |
| 04.3 + 04.4 same window — harder bisect | Separate commits; revert one guide independently |

**Rollback:** Revert 04.4 commit; set `WORKSHOP_AUTH_STOP_ENABLED=0`; 04.3 cooldown extension is backward-compatible if `authBudgetStop` defaults false.

---

## Status

**Executed** (2026-07-10) — commit `989749e`; mock/unit verification complete; live matrix deferred until subscription renewal.

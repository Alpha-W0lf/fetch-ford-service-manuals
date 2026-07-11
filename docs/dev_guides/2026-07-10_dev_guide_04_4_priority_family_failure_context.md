---
status: Ready
artifact_type: context-summary
work_item: 04.4-priority-family-failure-policy
pass: 12
readiness_score: 92
last_solidify: 2026-07-10
dev_guide: docs/dev_guides/2026-07-10_dev_guide_04_4_priority_family_failure_policy.md
plan_package: docs/dev_guides/2026-07-10_plan_package_04_4_priority_family_failure_policy.md
combined_sequence: docs/dev_guides/2026-07-10_combined_sequence_04_3_04_4.md
---

# Context summary — Guide 04.4 candidate: priority-family partial-failure policy

**Date:** 2026-07-10  
**Status:** Ready — Guide 04.3 executed (2026-07-10); implementation blocked until this plan package is approved.  
**Evidence log:** [2026-07-10_dev_guide_04_4_priority_family_failure_context.context-gather-log.md](./2026-07-10_dev_guide_04_4_priority_family_failure_context.context-gather-log.md)

## Work item overview

Priority Ford families—F-350, F-450, F-550, E-Series, Navigator, Expedition, and Explorer—experienced a broad mix of partial failures during the 2026-07-10 bulk run. They must remain recoverable, but the pipeline must not repeatedly spend worker time on the same systemic failure.

The required outcome is **reason-aware recovery**:

1. Preserve useful retries after temporary network, PTS/CDP, or content-auth failures recover.
2. Stop a vehicle early when a single run proves that PTS content access is persistently failing.
3. Reuse the existing capture-gap reasons (`auth`, `subscription-expired`, `timeout`, `network`, `browser-closed`, `error`) as durable failure evidence; do not invent a `cdp` reason without a demonstrated classification need.
4. Let the scheduler move to another useful vehicle while the failed vehicle waits for a verified recovery condition.
5. Never infer that a `subscriptionExpired` URL or a 403 means that the paid subscription ended.

### Scope boundaries

**In scope:** Workshop partial-download auth bursts; reason-coded wiring-TOC failure handling; recovery of zero-PDF auth failures after verified session recovery; redaction of cookie-bearing HTTP error objects in worker logs; evidence passed from worker to the existing orchestrator; bounded retry/cooldown behavior for the same vehicle; representative priority-family recovery verification.

**Out of scope:** Replacing PTS authentication, changing Ford CDN/Akamai behavior, altering all queue rank bands, expanding to a generic workflow engine, or changing Guide 04.2 stale/hung-worker behavior.

**Dependency boundary:** Guide 04.3 owns the first reusable per-vehicle cooldown and durable auth-evidence contract. Guide 04.4 must extend that contract rather than introduce competing state or an alternate scheduler.

## Acceptance criteria

- [ ] A shared 403/CDN failure across many priority families is classified as a content-auth/access event, not a family-specific catalog defect and not automatically as subscription expiration.
- [ ] A vehicle does not continue processing an unbounded number of documents after a configurable number of consecutive auth-class failures in one worker run.
- [ ] The worker persists the already-discovered capture gaps before it stops, and records the stop reason in a stable form usable by the scheduler.
- [ ] The scheduler distinguishes auth-class partial failures from transient network/CDP failures and from non-retryable code/data errors.
- [ ] A zero-PDF TreeAndCover auth failure persists a blocking `workshop:tree-and-cover` gap and exits intentionally as `incomplete`; cooldown applies via fast runtime and/or `authBudgetStop` — not the 50-PDF `failed` eligibility heuristic.
- [ ] A wiring-TOC auth failure is persisted as a structured blocking gap and produces an intentional incomplete/retryable outcome rather than an opaque `exit 1` full rerun.
- [ ] A partial auth run that would otherwise become queueable `failed` first records gaps and exits intentionally as `incomplete`; the shared 04.3 cooldown can then defer it without a global rank rewrite.
- [ ] Only successful connector-content preflight is an explicit recovery signal that clears auth cooldowns; cookie export alone never clears them or turns historical failures into success.
- [ ] Legitimate slow partial capture and recoverable one-off network failures retain bounded retry behavior.
- [ ] Workshop failure logs record method, URL, status, and a bounded response snippet but never serialize Axios request configuration, cookies, authorization headers, or full error objects.
- [ ] Tests cover the worker stop condition, persisted gap attempts, scheduler eligibility/cooldown, recovery, and no regression to Guide 04.2 hung reaping.

## Evidence-based classification

| Cluster | Evidence | Classification | Correct interpretation |
|---|---|---|---|
| F-350/F-450/F-550, Navigator, Expedition, E-Series failures | Early workshop `TreeAndCover` POST 403 / `Ford CDN returned Access Denied`; representative logs: `logs/2016-f-350.log`, `logs/2012-f-450.log`, `logs/2022-f-550.log`, `logs/2007-navigator.log`, `logs/2008-expedition.log`, `logs/2015-e-series.log` | Shared content-auth/CDN access failure | Not vehicle-family-specific; not proof that the subscription expired |
| Partial Super Duty / Navigator gaps | `capture-gaps.json` contains many `reason: "auth"` rows: 14 attempts (`2014-f-550`) and 52 attempts (`2017-navigator`) | Expensive repeatable partial auth failure | Worker must stop early and defer the vehicle |
| 2022 F-450 | `net::ERR_INTERNET_DISCONNECTED`; later CDP lock timeout | Network/CDP incident | Keep bounded transport retry; do not treat as auth expiry |
| Explorer 2014/2015 | Repeated partial Access Denied gaps; `logs/2014-explorer.log` contains repeated CDN HTML `Access Denied` responses | Candidate retry storm after partial capture | Requires the same reason-aware policy, but reproduction after a fresh session is required |
| Explorer 2017–2021 | Connector-only jobs logged `subscriptionExpired` auth redirects (e.g. `logs/2021-explorer.log`) | Stale live-CDP session signal | Directly within Guide 04.3’s auth-INCOMPLETE and connector-only accounting scope |
| Zero-PDF fill-year failures | E-Series, F-450, and many Expedition/Navigator jobs fail in the initial `TreeAndCover` request before any manual exists | Auth-access fast failure | Not immediately queueable because `failed` requires 50 PDFs; periodic idle-only reconcile can promote them, but recovery should be explicit and session-aware |
| Wiring-TOC auth path | `fetchTableOfContents()` can still throw before a gap is recorded; the orchestrator classifies any resulting nonzero partial run as `failed` | Verified code-path risk | The current 11:47 snapshot has no active wiring-TOC gap records; retain this as a controlled-reproduction case rather than claim it explains the current 3,441 workshop gaps |
| Current restart recovery | Successful `2020-expedition`, `2013-f-350`, `2012-f-550`, `2013-f-550`, and Explorers after earlier errors | Recovery evidence | PTS/subscription access was live after the failure windows |

## Verified root-cause chain

1. `src/httpRetry.ts` intentionally does **not** retry 403; it retries transient network and selected 5xx failures only.
2. `src/workshop/saveEntireManual.ts` catches each document failure while `--ignoreSaveErrors` is enabled, records a capture gap, and continues to the next document.
3. Its `maybeRefreshCookiesOnAuthStreak()` refreshes only the locally exported cookie file after five consecutive auth failures, resets the streak, then allows the same run to continue. It cannot prove that a live session recovered.
4. `src/wiring/fetchTableOfContents.ts` can surface a 403 without recording a gap; `src/index.ts` then exits nonzero. The orchestrator classifies the substantial partial download as `failed`, not a reason-coded `incomplete`. The replacement contract: record `wiringPageGapId("toc", wiringParams.book)` with expected file `Wiring/toc.json`, skip wiring capture, and let the worker exit 0 so status resolution yields `incomplete` (typically a fast run — 04.3 fast-fail cooldown applies without `authBudgetStop`).
5. `CaptureGaps.record()` correctly increments recorded-document attempts, but `scripts/queue-lib.js` applies stale-attempt deprioritization only to `incomplete`. Conversely, `failed` jobs with fewer than 50 PDFs are not immediately queueable; `reconcile-queue.js` can promote them later only when the worker pool is idle.
6. A partial worker run that exits nonzero becomes `failed`; any `failed` job with at least 50 PDFs remains queueable. Thus a vehicle with hundreds of persistent 403 gaps can consume repeated worker runs, while zero-PDF auth failures become stranded. The 04.4 MVP avoids a generic FAIL-path cooldown: it converts the verified early TreeAndCover and wiring-TOC auth paths to explicit gaps plus exit 0, then relies on the one 04.3 cooldown mechanism.
7. The global circuit breaker (`lib/bulk-circuit-breaker.js`) pauses fleet dispatch after recent auth failures, but it cannot reclaim time already spent processing a large failing vehicle and is intentionally not a per-vehicle retry policy.
8. The stale-gap guard uses the minimum attempt count across every blocking gap. A run that creates new gaps can remain fresh even while older gaps have many attempts; it is not a sufficient replacement for cooldown.
9. `src/logHttpError.ts` safely summarizes Axios errors, but `src/workshop/saveEntireManual.ts` also passes raw caught errors to `console.error` on ignored document failures. Live `2014-fiesta.log` evidence shows that this can serialize session cookies. The 04.4 worker change must route those paths through the sanitized helper instead.

## Runtime snapshot — 2026-07-10

### 11:47 local (queue frozen shortly after)

This is point-in-time operational evidence, not an estimate: the live queue contained 118 complete, 12 incomplete, 2 downloading, and 36 failed rows.

- The 12 incomplete rows preserve 14,522 PDFs and 3,441 blocking gaps. Every current blocking gap is a workshop `auth` 403, and every incomplete row is stale at the current 10-attempt threshold.
- The two active rows had roughly 1,375 additional workshop PDFs and were still growing. Together, the 14 partial rows held about 15.9k reusable PDFs.
- Ten of the twelve incomplete rows already have `Wiring/toc.json`; only `2014-expedition` and `2008-f-150` contain connector PDFs. `2014-expedition` is closest to completion with two workshop gaps.
- All 36 failed rows are empty, zero-PDF directories with no `capture-gaps.json`. They are a separate early TreeAndCover failure class, not partial work lost to status drift.
- `verifyDownload()` found no disk-complete/non-complete mismatch and no false-complete row. This rules out reconciliation as the immediate remedy.

**Planning consequence:** 04.4 must protect the large, reusable workshop partials from further auth waste, but it must not overstate wiring-TOC as the cause of the present backlog. The early TreeAndCover and wiring-TOC paths remain in scope because both lack structured early failure evidence and require a controlled reproduction before code.

### ~21:15 local (orchestrator down)

Bulk has been stopped since **~13:39 CDT** after `ERR_STREAM_WRITE_AFTER_END` in `spawnYarnStart` during repeated `FAIL` restarts on `2013-taurus` and `2014-fiesta`.

| Metric | Value |
|--------|-------|
| Complete | **129** (+11 since 11:47) |
| Incomplete | **12** unchanged (14,522 PDFs; 3,441 workshop `auth` gaps; all stale) |
| Failed | **36** unchanged (zero-PDF; no gaps) |
| Downloading | **2 orphaned** (`2013-taurus`, `2014-fiesta`; ~1.1k PDFs; ~1.4k new auth gaps) |
| Processes | **0** orchestrator / **0** workers; **stale bulk lock** |

**Planning consequence:** The evening failure validates 04.3's stream guard as P0 and shows why 04.4 must convert partial auth **FAIL** loops to intentional exit-0 `incomplete` outcomes. Operator recovery (fix locks, reconcile queue) is separate from implementing either guide.

## Subscription-lapsed operating mode (operator, 2026-07-10)

The operator believes the PTS **subscription may have expired**. Implications:

| Topic | Guidance |
|-------|----------|
| Code diagnosis | Stay cause-agnostic — `subscriptionExpired` URL and 403 are auth-class signals, not proof of lapse vs stale session |
| Bulk restart before renewal | **Low throughput value** — expect auth failures across families |
| 04.3 + 04.4 value without renewal | Orchestrator survival, slot protection, ~15.6k partial PDF preservation, worker waste reduction |
| Live soak between 04.3 and 04.4 | **Skip** — use unit/mock tests; live four-case matrix when subscription renews |
| Recommended sequence | 04.3 commit → 04.4 commit (same maintenance window) → optional restart when renewed |
| Recovery signal | `connectorPreflight()` success clears cooldowns only when live content access works |

See [combined sequence doc](./2026-07-10_combined_sequence_04_3_04_4.md).

## Related work and correct guide boundaries

| Guide | Responsibility | Decision |
|---|---|---|
| 04.2 | Detect/reap hung workers and preserve disk truth | Executed; retain thresholds and behavior |
| 04.3 | Fast `INCOMPLETE` auth storm; record connector-only auth gaps; persistent auth evidence; per-vehicle cooldown | Keep focused on the connector-only early-return path, but make its cooldown module reusable by 04.4 |
| **04.4** | Stop expensive in-worker partial auth bursts; preserve wiring-TOC auth failures as gaps; safely recover zero-PDF auth failures through the existing 04.3 cooldown | Formal dev guide ready; implement after 04.3 |
| Later triage | Durable source/data defects, CDP lock tuning, and code exceptions | Do not conflate with auth policy; triage from the new evidence record |

**Why not fold all of this into 04.3:** 04.3 has a precise verified defect: auth-bearing `INCOMPLETE` returns before circuit accounting and connector-only failures do not increment gap attempts. This work changes worker-level workshop behavior and `failed`-status scheduling. Combining them would create a larger, harder-to-test release and risks duplicating cooldown policy. The only cross-guide contract should be the reusable vehicle cooldown / failure-evidence interface.

## Architecture proposal (draft)

```text
document error
  → existing canonical gap reason
  → gap persisted
  → worker-local consecutive-failure budget
  → [budget exceeded for auth] stop current vehicle deliberately
  → stable vehicle failure evidence
  → 04.3 cooldown / scheduler eligibility
  → next independent job
```

Constraints:

- Do not add a second scheduler or alter global queue rank bands.
- Do not change 04.2 hung-reap thresholds.
- Do not mark partial data `complete` merely to escape the queue.
- Persist only minimal reason, timestamp, and count; never log cookies or PTS secrets. Do not add a recovery-generation state machine: 04.3's verified connector-content preflight is the sole cooldown-clear signal.
- Keep network/CDP retries bounded and separate from auth behavior.

## Infrastructure and knowledge status

### Known

- Live PTS Chrome/CDP and cookie export recovered successfully during the run.
- Subscription-cookie presence and successful later downloads disprove a blanket “subscription ended” diagnosis.
- The worker can spend substantial time on document-level 403s before returning.
- The queue’s stale-gap priority guard does not apply to partial `failed` jobs.

### Phase 0 decisions and verification (mock-first if subscription lapsed)

| Case | Setup | Expected observable result | Policy decision validated |
|------|-------|----------------------------|---------------------------|
| Zero-PDF TreeAndCover 403 | Fresh output directory; mock or reproduce early workshop 403 | One `workshop:tree-and-cover` gap; exit 0; `incomplete`; cooldown when auth-class + fast runtime or `authBudgetStop` | No `failed` stranding for zero-PDF |
| Partial workshop + wiring-TOC 403 | Existing workshop artifacts; mock TOC 403 | One `wiring-page:toc:<book>` gap; exit 0; artifacts preserved | Intentional incomplete, not `failed` |
| Workshop auth-budget mid-run | Mock N consecutive auth-class doc failures | `[auth-budget-stop]` in log; gaps persisted; recursive TOC respects stop flag; exit 0 | In-worker waste bounded |
| Connectors-only `subscriptionExpired` | Existing `Wiring/toc.json` | 04.3 path only; no workshop budget | Boundary with 04.3 |
| `ERR_INTERNET_DISCONNECTED` | Injected transport failure | No auth-budget stop; no auth cooldown | Auth/network separation |

### Edge cases (verified in source, planned in guide)

| Edge case | Resolution |
|-----------|------------|
| `saveEntireManual` recurses into nested TOC folders | `authBudgetStopRequested` propagates to parent loops |
| `subscription-expired` gaps today do not increment refresh streak | Use shared `isAuthClassReason` for refresh + stop |
| Workshop budget stop then wiring phase runs | **Accepted MVP** — partials may still complete wiring/connectors |
| `resolveFinalVehicleStatus` | exit 0 + disk `incomplete` → queue `incomplete` (`bulk-orchestrator-lib.js:107–108`) |

Additional Phase 0 contract decisions:

- Preserve `WORKSHOP_AUTH_REFRESH_THRESHOLD` as one local refresh attempt per run. Guide 04.4 defines `WORKSHOP_AUTH_STOP_THRESHOLD` (default 10) greater than that refresh threshold.
- An intentional workshop auth-budget stop must not throw `PtsAuthError`: it records its gap(s), logs `[auth-budget-stop]`, returns normally, and therefore exits 0. Existing unhandled `PtsAuthError` exit 2 remains unchanged and is outside the 04.4 MVP unless the reproduction matrix demonstrates a gapless retry storm.
- Lock the 04.3 cooldown/evidence interface after 04.3 implementation; 04.4 extends it with `authBudgetStop` for `[auth-budget-stop]` incomplete outcomes (bypasses 60s fast-fail runtime).
- The current 12 incomplete rows are already stale (all known blocking gaps have at least 10 attempts). The future 04.4 waste target is therefore in-worker auth iteration before a partial job reaches this stale state or exits as a queueable `failed`, not a global re-ranking of the preserved backlog.

### Unknown — not blocking planning

- Whether Ford CDN 403s represent stale content entitlement, temporary Akamai controls, or another external condition. The code must not depend on distinguishing these.
- Which current priority-family gaps remain after one controlled retry with a freshly healthy session. This is a Phase 0 test, not a reason to restart healthy bulk.

## Blast radius and risks

| Area | Risk | Mitigation |
|---|---|---|
| `src/workshop/saveEntireManual.ts` | Premature stop can leave valuable pages uncaptured | Only stop after a conservative consecutive auth budget; persist every gap first |
| `lib/bulk-orchestrator-lib.js` / queue policy | Cooldown can suppress legitimate recovery | Require reason-coded evidence; `connectorPreflight()` success clears cooldowns |
| 04.3 interface | Two inconsistent cooldown mechanisms | Implement 04.3 first; define one reusable contract |
| PTS availability | External 403 root cause is opaque | Treat signals as classification, log evidence, and make recovery observable |
| Active bulk | Orchestrator changes would interrupt throughput | Documentation only until a planned stop |
| Error logs | Raw Axios configuration can expose session cookies | Reuse `logHttpError()` in workshop catch paths; add a redaction regression test; treat existing affected logs as sensitive |

## Readiness assessment

**Can implement now:** No — 04.3 must commit first.  
**Can implement immediately after 04.3:** **Yes** (revised) — if plan packages approved and tests green; skip live soak if subscription lapsed.  
**Recommended order:**

1. Implement and commit Guide 04.3.
2. Implement and commit Guide 04.4 in the same maintenance window (separate commits).
3. Run mock/unit repro matrix during 04.4 implementation; live matrix when subscription renews.
4. Optional blessed Terminal restart when subscription live or operator accepts auth-idle cycling with new protections.

**Next action:** Approve plan packages; operator recovery; Phase 0; implement 04.3 then 04.4.

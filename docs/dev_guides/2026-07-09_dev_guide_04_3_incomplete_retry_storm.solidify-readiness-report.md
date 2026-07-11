# Solidify readiness report — Dev Guide 04.3 INCOMPLETE retry storm

**Artifact:** `docs/dev_guides/2026-07-09_dev_guide_04_3_incomplete_retry_storm.md`  
**Context summary:** `docs/dev_guides/2026-07-09_dev_guide_04_3_context.md` (Ready, 96/100)  
**Plan package:** `docs/dev_guides/2026-07-10_plan_package_04_3_incomplete_retry_storm.md`  
**Final score:** **96/100**  
**Passes:** 9  
**Certification:** **passed** (plan-ready; implementation requires operator plan-package approval)

---

## Score trajectory

| Pass | Score | Δ | Sections touched |
|------|-------|---|------------------|
| 1 | 84 | — | Objective; checklist draft |
| 2 | 88 | +4 | Architectural pattern; env vars |
| 3 | 91 | +3 | Frozen 04.3→04.4 contract |
| 4 | 96 | +5 | Step 5 gap ownership; non-duplication rules |
| 5 | 97 | +1 | JSONL evidence; precedence |
| 6 | 97 | 0 | Validation pass |
| 7 | 94 | −3 | Stream-crash evidence integrated |
| 8 | 95 | +1 | FAIL vs INCOMPLETE boundary |
| 9 | 96 | +1 | Operator recovery; atomic write; plan package link |

---

## Final dimension breakdown

| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 19/20 | Seven ordered steps; TDD-first; stream fix before scheduler changes |
| Path / symbol verification | 19/20 | `runOne` INCOMPLETE/FAIL paths, `connectorPreflight`, gap helpers verified in source |
| Risk & blast radius per step | 19/20 | FAIL-path limitation explicit; 04.2 reaper boundary documented |
| Test & verification plan | 19/20 | Four test surfaces + manual stale-session check; stream test seam noted |
| Checklist completeness & order | 20/20 | Gates, rollback, docs, operator recovery, env vars aligned |

---

## Why not 100%

1. **`spawnYarnStart` is not exported** today — Step 1 must add an export or document an injected-deps test path before the stream regression can land cleanly.
2. **Phase 0 assumptions** (`connectorPreflight` clears cooldowns; `connectorPortalReady` flag) need focused tests during implementation, not more planning.
3. **Formal operator approval** is still pending — certification covers plan quality, not execution authorization.

---

## Verification evidence (final pass)

| Claim | Source |
|-------|--------|
| INCOMPLETE returns before `recordAuthFailure` | `lib/bulk-orchestrator-lib.js:565–570` vs FAIL at `582–584` |
| Stream double-end bug | `spawnYarnStart` `error` handler calls `logStream.end()` at `463–465` while `close` also ends at `459–461` |
| Evening orchestrator crash | `logs/bulk-download-20260710-0022.log` — `ERR_STREAM_WRITE_AFTER_END` after `FAIL: 2014-fiesta` / `2013-taurus` |
| Atomic write precedent | `lib/patch-queue.js:88–89` (write temp + rename) |
| Gap ID helpers | `src/captureGaps.ts` — `wiringConnectorGapId`, `wiringPageGapId` |
| `saveConnector` throws `PtsAuthError` before terminal streak record | `src/wiring/saveConnector.ts` |
| Existing orchestrator test harness | `test/bulk-orchestrator.test.ts` — temp roots, mocked deps pattern |
| Preserved partial progress | 12 incomplete rows, 14,522 PDFs, 3,441 workshop `auth` gaps; no disk/queue mismatch |

---

## Remaining gaps (non-blocking for plan approval)

| Gap | Owner | When |
|-----|-------|------|
| Operator plan-package sign-off | Tom | Before Phase 1 |
| Export or inject `spawnYarnStart` for stream test | Implementation | Step 1 |
| Phase 0 `yarn test` / `yarn typecheck` | Implementation | Phase 0 |
| Operator recovery (locks, reconcile) | Tom | Before Phase 0 or restart |
| Guide 04.4 formal dev guide | After 04.3 soak + repro matrix | Later |

---

## Certification checklist

- [x] **C1** — three or more distinct passes completed (9)
- [x] **C2** — each pass recorded as independent critique/revise cycle
- [x] **C3** — scores trended upward overall (84 → 96)
- [x] **C4** — no final dimension below 18/20
- [x] **C5** — final pass states why score is not 100
- [x] **C6** — first formal pass score was 88 or lower (84)
- [x] **C7** — every pass changed named artifact sections
- [x] **C8** — final pass contains source and runtime verification evidence
- [x] **CD1** — objective, context links, and implementation gate present
- [x] **CD2** — ordered checklist with verification and blast radius
- [x] **CD3** — frozen cross-guide contract (04.3 → 04.4)
- [x] **CD4** — rollback documented
- [x] **CD5** — linked context summary at Ready ≥ 94

---

## Implementation authorization

**Plan certification:** passed at 96/100.  
**Implementation authorization:** **not granted** — requires operator approval of [plan package](./2026-07-10_plan_package_04_3_incomplete_retry_storm.md) and Phase 0 gate per `prompt_follow_dev_guide.md`.

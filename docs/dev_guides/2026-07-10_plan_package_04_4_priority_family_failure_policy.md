# Plan package — Dev Guide 04.4 (priority-family partial-failure policy)

**Date:** 2026-07-10  
**Status:** Awaiting operator approval — **implement only after Guide 04.3 is committed**  
**Dev guide:** [2026-07-10_dev_guide_04_4_priority_family_failure_policy.md](./2026-07-10_dev_guide_04_4_priority_family_failure_policy.md)  
**Context:** [2026-07-10_dev_guide_04_4_priority_family_failure_context.md](./2026-07-10_dev_guide_04_4_priority_family_failure_context.md)  
**Combined sequence:** [2026-07-10_combined_sequence_04_3_04_4.md](./2026-07-10_combined_sequence_04_3_04_4.md)  
**Prerequisite:** [2026-07-09_dev_guide_04_3_incomplete_retry_storm.md](./2026-07-09_dev_guide_04_3_incomplete_retry_storm.md) executed

---

## One-sentence objective

Stop in-worker auth waste and partial **FAIL** loops by recording structured gaps, exiting intentionally as `incomplete`, and extending the 04.3 cooldown for `[auth-budget-stop]` outcomes — without rewriting queue ranks or merging with 04.3.

---

## What ships in 04.4 (6 deliverables)

| # | Deliverable | Primary files |
|---|-------------|---------------|
| 1 | Workshop auth-budget stop (default: 10 consecutive auth failures) | `src/workshop/saveEntireManual.ts` |
| 2 | TreeAndCover 403 → `workshop:tree-and-cover` gap + exit 0 | `src/index.ts` (`modernWorkshop`) |
| 3 | Wiring TOC 403 → `wiring-page:toc:<book>` gap + exit 0 | `src/index.ts` |
| 4 | Cooldown extension for `[auth-budget-stop]` (no 60s runtime req) | `lib/vehicle-cooldown.js`, `runOne` |
| 5 | SEC-01 log redaction in workshop paths | `saveEntireManual.ts`, `logHttpError.ts` |
| 6 | Tests + docs | `test/`, `docs/reference/` |

**Default:** `WORKSHOP_AUTH_STOP_THRESHOLD=10` (must be > existing refresh threshold of 5).

---

## Why immediately after 04.3 (revised sequence)

Operator believes subscription may be lapsed. In that mode:

- Multi-hour live soak between guides has **low value** (no productive completes expected).
- Evening crash showed **FAIL-path** waste 04.3 alone cannot fix.
- ~15.6k partial PDFs remain at risk on restart without 04.4.
- Separate commits preserve bisectability; same maintenance window is fine.

**Still do not merge guides into one diff.**

---

## Blast radius

| Area | Risk |
|------|------|
| `saveEntireManual.ts` | Medium — core workshop loop |
| `src/index.ts` | Medium — early-failure wrappers |
| `vehicle-cooldown.js` | Low — small extension |
| Orchestrator `runOne` | Low — log marker detection |

**Not touched:** `bulk-download.sh`, CDP lock, queue schema, global ranks.

---

## Subscription-lapsed mode

| If subscription expired | Action |
|-------------------------|--------|
| Implement 04.4 anyway? | **Yes** — hardening before renewal |
| Live repro matrix during impl? | **Mock/unit only** |
| Restart bulk after 04.3+04.4? | **Optional** — only if renewed or accepting auth-idle with cooldown |
| `connectorPreflight` recovery | Unavailable until live content access returns |

---

## Gates

| Gate | Status |
|------|--------|
| 04.3 committed + tests green | **Met** (pending this push) |
| This plan package approved | Pending |
| Bulk stopped | **Met** |
| Phase 0 tests green | Pending at 04.4 start |

---

## Approval

- [ ] I approve Plan Package 04.4 for implementation **immediately after** Guide 04.3 commits and tests pass.
- [ ] I accept separate commits per guide (not one merged release).
- [ ] I understand live bulk verification is deferred if subscription remains lapsed.

**Approved by:** _______________  
**Date:** _______________

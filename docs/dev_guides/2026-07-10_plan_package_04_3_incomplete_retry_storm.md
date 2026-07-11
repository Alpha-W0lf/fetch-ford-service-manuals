# Plan package — Dev Guide 04.3 (INCOMPLETE retry storm)

**Date:** 2026-07-10  
**Status:** Awaiting operator approval — **do not implement until signed off below**  
**Dev guide:** [2026-07-09_dev_guide_04_3_incomplete_retry_storm.md](./2026-07-09_dev_guide_04_3_incomplete_retry_storm.md)  
**Context:** [2026-07-09_dev_guide_04_3_context.md](./2026-07-09_dev_guide_04_3_context.md)  
**Readiness report:** [2026-07-09_dev_guide_04_3_incomplete_retry_storm.solidify-readiness-report.md](./2026-07-09_dev_guide_04_3_incomplete_retry_storm.solidify-readiness-report.md)  
**Issue:** REL-08 (+ stream-crash hardening) in [known_issues_and_backlog.md](../known_issues_and_backlog.md)

---

## One-sentence objective

Stop parallel-slot waste from fast auth **INCOMPLETE** retry storms, prevent orchestrator death from `spawnYarnStart` stream lifecycle bugs, and freeze a reusable per-vehicle cooldown contract for Guide 04.4 — without touching global queue ranks or workshop worker behavior.

---

## What ships in 04.3 (7 deliverables)

| # | Deliverable | Primary files |
|---|-------------|---------------|
| 1 | **Stream guard (P0)** — child `error` must not `logStream.end()`; `close` owns shutdown | `lib/bulk-orchestrator-lib.js` |
| 2 | **Auth-aware INCOMPLETE** — `recordAuthFailure` + classification on INCOMPLETE path | `lib/bulk-orchestrator-lib.js` |
| 3 | **Per-vehicle cooldown** — exclude fast-auth INCOMPLETE vehicles from `nextJob` | **New** `lib/vehicle-cooldown.js`, orchestrator |
| 4 | **Durable auth evidence** — append-only JSONL audit sidecar | `logs/recent-auth-events.jsonl` |
| 5 | **Narrow wiring gap accounting** — probe / auth-streak / LocIndex only | `src/wiring/saveEntireWiring.ts` |
| 6 | **Tests first** — cooldown, orchestrator, wiring gaps, stream regression | `test/` |
| 7 | **Docs** — env vars, architecture, REL-08 resolved | `docs/reference/`, backlog |

**Default tuning (env-overridable):** 3 fast fails (&lt;60s) → 15 min cooldown.

---

## Explicitly out of scope (defer to 04.4 or later)

- Fast auth-class **FAIL** cooldown (e.g. `2013-taurus` / `2014-fiesta` evening loop)
- In-worker workshop auth-budget stops (`saveEntireManual.ts`)
- Zero-PDF TreeAndCover → exit-0 incomplete conversion
- Wiring-TOC auth gap + exit-0 incomplete
- Cookie log redaction (SEC-01)
- Global `queueRank` rewrite
- Re-ranking or reconciling the ~15.6k preserved partial PDFs as a “fix”

---

## Why this split is correct

Tonight's orchestrator crash was a **FAIL** path loop that exposed a **stream bug** (04.3 fixes the crash) and **slot waste** that 04.4 must address via intentional exit-0 incomplete. Merging both guides would increase blast radius and duplicate policy risk.

---

## Blast radius (honest)

| Area | Risk | Mitigation |
|------|------|------------|
| `spawnYarnStart` | Low — localized lifecycle fix | Regression test with mocked child streams |
| `vehicle-cooldown.js` | Low — new isolated module | Atomic write; orchestrator single-writer |
| INCOMPLETE auth path | Medium — false-positive cooldown | Require auth gap reason + log + fast runtime |
| `connectorPreflight` clear | Medium — premature clear | Clear cooldowns only on preflight **success**, never cookie-export alone |
| Wiring gap records | Low–medium — duplicate IDs | Explicit non-duplicating ID rules in Step 5 |
| 04.2 hung reaper | Medium — regression | Reaped workers must not increment cooldown |

**Not touched:** `bulk-download.sh`, CDP lock, capture-params, queue JSON schema.

**Rollback:** `git revert` → delete `logs/vehicle-cooldown.json` + `logs/recent-auth-events.jsonl` → blessed Terminal restart.

---

## Current runtime (2026-07-10 ~21:15)

Bulk **stopped** since ~13:39 CDT. **0 workers.** Stale bulk lock. **129** complete, **12** incomplete (14,522 PDFs preserved), **36** failed (zero-PDF), **2** orphaned `downloading`. ~**15.6k** reusable partial PDFs intact.

---

## Implementation order (TDD)

1. Tests first (cooldown, orchestrator, wiring gaps, **stream regression**)
2. Stream guard (Step 2 — ship early; prevents orchestrator death)
3. INCOMPLETE auth + JSONL evidence (Step 3)
4. Cooldown module + scheduler integration (Step 4)
5. Wiring gap accounting (Step 5)
6. Full test pass + docs (Steps 6–7)

**Test seam note:** `spawnYarnStart` is currently internal to `bulk-orchestrator-lib.js`. Step 1 should export it for the stream regression test (or test via injected `deps.spawn` through `runOne` — prefer direct export for clarity).

---

## Gates before code

| Gate | Status |
|------|--------|
| Bulk stopped | **Met** (crashed ~13:39) |
| Plan package approved | **Pending — you** |
| Phase 0: `yarn test` + `yarn typecheck` green | Pending |
| Operator recovery (locks + reconcile) | Recommended before Phase 0; separate from code |
| Read AM runtime observations doc | Pending at Phase 0 |

---

## Operator recovery (recommended now, no code)

```bash
./scripts/pipeline-health.sh --fix-locks
node scripts/reconcile-queue.js
./scripts/queue-status.sh --health
```

Do **not** restart bulk from Cursor/agent shells. Use `./scripts/start-bulk-in-terminal.sh` only when you explicitly choose to resume.

---

## Post-04.3 sequence (04.4 — revised per operator)

See [combined sequence](./2026-07-10_combined_sequence_04_3_04_4.md).

1. Commit Guide 04.3 → verify tests → commit Guide 04.4 (same window, **separate commits**)
2. Mock/unit repro during 04.4; live repro when subscription renews
3. Optional bulk restart only if subscription live or operator accepts auth-idle with new protections

---

## Decisions (operator-agreed unless noted)

| # | Decision | Agreed? |
|---|----------|---------|
| **D1** | Approve plan package 04.3 | Pending sign-off |
| **D2** | Operator recovery now (locks + reconcile) | **Yes** |
| **D3** | Wait for 04.3+04.4 before bulk restart | **Yes** |
| **D4** | Default cooldown tuning (60s / 3 / 900s) | **Yes** |
| **D5** | 04.4 immediately after 04.3 commit (separate commits) | **Yes** (revised) |

---

## Approval

- [ ] I approve Plan Package 04.3 and authorize implementation per `second_brain/docs/guides/prompt_follow_dev_guide.md` Phase 0 onward.
- [ ] I have read the [combined 04.3+04.4 sequence](./2026-07-10_combined_sequence_04_3_04_4.md) and accept 04.4 immediately after 04.3 (separate commits).
- [ ] Operator recovery decision: run now / defer / restart on current code (circle one).

**Approved by:** _______________  
**Date:** _______________

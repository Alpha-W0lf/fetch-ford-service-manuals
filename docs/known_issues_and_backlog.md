# Known issues, tech debt & backlog registry

**Date:** 2026-07-08 (checkpoint ~22:48 local)  
**Purpose:** Single prioritized registry of open issues, tech debt, and future dev-guide candidates. Use this to plan work after the subscription window or during deliberate maintenance stops.

**Related:**
- [2026-07-08_pipeline_inventory_and_action_items.md](./2026-07-08_pipeline_inventory_and_action_items.md) — ops action items
- [2026-07-08_pipeline_runtime_observations.md](./2026-07-08_pipeline_runtime_observations.md) — live session evidence
- [2026-07-08_codebase_foundation_context_assessment.md](./2026-07-08_codebase_foundation_context_assessment.md) — foundation scores & phases
- [dev_guides/README.md](./dev_guides/README.md) — implementation blueprints (01–04 executed; 05–06 planned)

**Priority key:** **P0** blocks subscription throughput · **P1** reliability/maintainability · **P2** nice-to-have · **P3** post-subscription

---

## Active runtime issues (2026-07-08 ~22:48)

| ID | Severity | Issue | Evidence | Mitigation / future fix |
|----|----------|-------|----------|------------------------|
| **RUN-01** | **P0** | **Bulk orchestrator stall** | [Investigation](./2026-07-09_bulk_stall_root_cause_investigation.md) | **Fix deployed** Guide 04.1 (2026-07-09) — operator soak Step 8 pending |
| **RUN-02** | P1 | **Hung `prune-cdp-tabs.ts` processes** | Orchestrator child + 3h orphans from prior sessions (s022) | `CDP_DISCONNECT_TIMEOUT_MS` in Guide 04.1; kill stale prunes manually if needed |
| **RUN-03** | P1 | **`2016-f-250` connector job interrupted** | 2302 PDFs; log ends mid-connector save; prior INCOMPLETE in bulk log | Will retry on orchestrator restart; expect gap registry update |
| **RUN-04** | P1 | **`2018-expedition-max` incomplete** | 2219 PDFs; `Capture incomplete: 1 gap (wiring-connector:1)` | Hybrid-complete or gap-fill on retry |
| **RUN-05** | P1 | **Auth burst — 19 `failed`** | ~02:29 UTC rapid 403s; stable since | Auto-retry via queue rank; re-login PTS if count climbs |
| **RUN-06** | P1 | **Capture E-Transit tier-1 fails** | `2022-e-transit`, `2023-e-transit`: model not in PTS menu (not alias issue) | Investigate PTS year/model availability; may need skip or alternate PTS entry — **not fixed by `modelMatchers` alone** |
| **RUN-07** | P2 | **Chrome error tabs** (reset / ERR_TIMED_OUT) | Failed `page.goto` under CDP load | Expected under stress; refresh PTS if capture stops |
| **RUN-08** | P2 | **Capture PTS home timeouts** | `2009-crown-victoria` 90s timeout | Refresh PTS Chrome; capture continues on retry pass |

---

## Operational / supervision issues

| ID | P | Issue | Status | Dev guide / notes |
|----|---|-------|--------|-------------------|
| **OPS-01** | P0 | Bulk must start from **Terminal.app**, not Cursor shell | ✅ Documented `AGENTS.md` | — |
| **OPS-02** | P0 | No proven **auto-supervisor** (launchd watchdog unverified) | Open | Phase G — prove FDA path or remove |
| **OPS-03** | P0 | **macOS TCC** blocks launchd scripts in `~/Documents` | Open | Watchdog experimental only |
| **OPS-04** | P1 | **Stale locks** after killed orchestrator | Mitigated `bulk-lock.js` | `pipeline-health.sh --fix-locks` |
| **OPS-05** | P1 | **Multiple overlapping launchers** | Documented | Phase G consolidate |
| **OPS-06** | P2 | **No orchestrator heartbeat** in bulk log | Open | Phase G or Guide 04.1 |
| **OPS-07** | P2 | **Capture pass summary** not logged | Open | Guide 05 optional `cli.ts` line |

---

## Pipeline / throughput issues

| ID | P | Issue | Count / impact | Future work |
|----|---|-------|----------------|-------------|
| **PIPE-01** | P0 | **`needs_params` backlog** | **40** vehicles (was 54 at session start; **14 captured** this session) | Capture retry pass in progress |
| **PIPE-02** | P1 | **CDP lock contention** — long connector jobs starve capture first pass | 32 deferred → retry pass | By design (Guide 03); throughput tradeoff |
| **PIPE-03** | P1 | **`2016-f-250` connector `page.goto` timeouts** | 15+ in log | PTS load; retry in worker |
| **PIPE-04** | P1 | **`2011-f-450` incomplete** | Tier-1 gap-fill pending | Auto when slot free |
| **PIPE-05** | P2 | **Borderline year capture fails** | `2003-f-250` workshop intercept | Guide 06 / manual edge case |
| **PIPE-06** | P2 | **Intermittent capture UI timeouts** | `2010-taurus`, `2012-escape` | Retry pass; PTS refresh |
| **PIPE-07** | P3 | **Pre-2003 automation** | 3 Excursions `needs_params` | Guide 06 after Guide 05 + exploration doc |

---

## Code / architecture tech debt

| ID | P | Issue | Location | Planned fix |
|----|---|-------|----------|-------------|
| **CODE-01** | P1 | **`capture-params.ts` monolith** (890 lines) | `scripts/capture-params.ts` | **Guide 05** — `src/capture/` split |
| **CODE-02** | P1 | **`patchVehicleStatus` spawns CLI** | `capture-params.ts:49-51` | Guide 05 → `lib/patch-queue.js` direct |
| **CODE-03** | P2 | **`bulk-orchestrator-lib.js` size** (~668 lines) | `lib/` | Optional Guide 04.1 split |
| **CODE-04** | P2 | **Lock module duplication** | `bulk-lock.js`, `cdp-chrome-lock.js` | Phase G — shared lock primitive |
| **CODE-05** | P2 | **Path-resolve dual implementation** | `src/pathResolve.ts`, `lib/path-resolve.js` | Parity tests exist; optional merge |
| **CODE-06** | P2 | **Whole-file queue rewrites** | `reconcile-queue.js`, `backfill-capture-gaps.js`, generators | Run only when workers idle |
| **CODE-07** | P2 | **`scripts/*.ts` not in `tsc` scope** | `tsconfig.json` | Phase G — extend typecheck |
| **CODE-08** | P2 | **Prettier excludes `scripts/`** | `package.json` | Phase G pre-commit |
| **CODE-09** | P3 | **Duplicate cookie refresh** at worker start | orchestrator + worker | Defer until bulk stops |
| **CODE-10** | P3 | **`README.md` upstream-centric** | root | Post-subscription doc pass |

---

## Resolved (do not re-open without new evidence)

| Item | Resolution | Guide / commit |
|------|------------|----------------|
| macOS `flock` missing | `bulk-lock.js` | Pre-Guide 04 |
| 504-line bash orchestrator | `bulk-orchestrator.js` + thin wrapper | Guide 04 |
| CDP session-long lock starves capture | Per-connector lock + capture defer | Guide 03 |
| Aggressive tab prune closed live connector tab | Safe prune rules | Guide 03 + `cdp_tab_hygiene.md` |
| `captureGaps` TS/JS contract drift | `lib/capture-gaps-rules.js` + tests | Guide 02 |
| No unit tests / CI | 75 Vitest tests + `.github/workflows/test.yml` | Guide 02 + 04.1 |
| Orphan `downloading` on worker exit | `fixOrphanDownloading` in `reapWorkers` | Guide 04 — **extended by 04.1** `reapStaleWorkers` for `done: false` |
| Bulk orchestrator parallel stall (RUN-01) | Removed blocking orchestrator prune; PID stale reap | Guide 04.1 |

---

## Capture failures this session (for matcher / retry tuning)

| Vehicle | Error class | Notes |
|---------|-------------|-------|
| `2003-f-250` | Workshop intercept miss | Borderline year |
| `2010-taurus` | `locator.waitFor` timeout | UI timing |
| `2009-crown-victoria` | PTS home `page.goto` 90s | CDP contention |
| `2012-escape` | Execution context destroyed | Navigation race |
| `2022-e-transit` | Model not in PTS menu | **PTS catalog gap — not matcher** |
| `2023-e-transit` | Model not in PTS menu | Same |

**Captured OK (15):** `2009-navigator`, `2009-flex`, `2010-navigator`, `2010-fusion`, `2011-navigator`, `2011-edge`, `2011-fiesta`, `2012-edge`, `2012-fusion`, `2012-taurus`, `2012-fiesta`, `2012-flex`, `2013-edge`, `2013-fiesta`, `2014-edge`

---

## Future dev guides (after 05 & 06)

| Track | Scope | Priority |
|-------|-------|----------|
| **Guide 05** | Capture modularization | **Next** — implementation-ready |
| **Guide 06** | Pre-2003 legacy capture | After 05 + `legacy_pts_capture.md` filled |
| **Phase G** | Pre-commit, health consolidation, orchestrator heartbeat, prune timeout, watchdog decision | Post-subscription or maintenance window |
| **Guide 04.1** | Orchestrator reliability | **Executed** (2026-07-09) — operator soak pending |
| **Guide 07** (not authored) | E-Transit PTS availability / alternate capture path | If tier-1 blocked after retry |

---

## Open questions (operator decisions)

1. **Watchdog:** Finish (FDA grant) vs remove post-subscription?
2. **Tier-1 incomplete policy:** Always gap-retry vs accept `incomplete` and move on?
3. **E-Transit:** Skip tier-1, manual params, or alternate PTS navigation?
4. **Bulk stall (RUN-01):** Fix deployed — restart bulk from Terminal.app for soak verification |

---

## Changelog

| Date | Update |
|------|--------|
| 2026-07-09 | Guide 04.1 executed — RUN-01 fix deployed; 75 tests |

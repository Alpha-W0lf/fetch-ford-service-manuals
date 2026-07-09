# Known issues, tech debt & backlog registry

**Date:** 2026-07-09 (checkpoint ~00:00 local)  
**Purpose:** Single prioritized registry of open issues, tech debt, and future dev-guide candidates. Use this to plan work after the subscription window or during deliberate maintenance stops.

**Related:**
- [2026-07-09_pipeline_session_checkpoint.md](./2026-07-09_pipeline_session_checkpoint.md) — **latest session** (Guide 04.1, soak, REL gaps)
- [2026-07-08_pipeline_inventory_and_action_items.md](./2026-07-08_pipeline_inventory_and_action_items.md) — ops action items
- [2026-07-08_pipeline_runtime_observations.md](./2026-07-08_pipeline_runtime_observations.md) — live session evidence
- [2026-07-08_codebase_foundation_context_assessment.md](./2026-07-08_codebase_foundation_context_assessment.md) — foundation scores & phases
- [dev_guides/README.md](./dev_guides/README.md) — implementation blueprints (01–04.1 executed; 05–06 planned)

**Reliability bar:** Bulk + capture must run **unsupervised 4–12+ hours** without manual kill/restart. Guide 04.1 fixed orchestrator freeze; **REL-*** items below track remaining gaps.

**Priority key:** **P0** blocks subscription throughput · **P1** reliability/maintainability · **P2** nice-to-have · **P3** post-subscription

---

## Active runtime issues (2026-07-09 ~00:00)

| ID | Severity | Issue | Evidence | Mitigation / future fix |
|----|----------|-------|----------|------------------------|
| **RUN-01** | ~~P0~~ | **Bulk orchestrator stall** | [Investigation](./2026-07-09_bulk_stall_root_cause_investigation.md) | **Fixed** Guide 04.1 (`6c15180`) — early soak positive; see [checkpoint](./2026-07-09_pipeline_session_checkpoint.md) |
| **RUN-02** | P1 | **Hung / orphan `prune-cdp-tabs.ts` processes** | PIDs 91052/91119 ~4h+ from prior session; not under current orchestrator | `CDP_DISCONNECT_TIMEOUT_MS` (04.1); **REL-03** orphan reaper |
| **RUN-05** | P1 | **Auth burst — 19 `failed`** | ~02:29 UTC rapid 403s; stable since | Auto-retry via queue rank; cookie refresh 3h |
| **RUN-06** | P1 | **Capture E-Transit tier-1 fails** | `2022/2023/2024-e-transit`: model not in PTS menu | PTS catalog gap — not `modelMatchers`; Guide 07 candidate |
| **RUN-07** | P2 | **Chrome error tabs** (reset / ERR_TIMED_OUT) | Failed `page.goto` under CDP load | Expected under stress |
| **RUN-08** | P2 | **Capture PTS home timeouts** | `2009-crown-victoria` 90s timeout | Retry pass; PTS refresh |

---

## Unsupervised reliability gaps (engineering — not manual ops)

| ID | P | Gap | Failure mode | Planned fix |
|----|---|-----|--------------|-------------|
| **REL-01** | **P0** | **Hung-alive worker** | Yarn PID lives, log frozen, slot blocked (2016 TCM ~9 min @ 99% CPU) | **Guide 04.2** executed — `reapHungWorkers` |
| **REL-02** | P1 | **Capture no clean exit** | Session done but node process idle | **Guide 04.2** Tier B — CDP `browser.close()` disconnect |
| **REL-03** | P1 | **Orphan prune reaper** | Old `prune-cdp-tabs` survive hours, compete for CDP | **Guide 04.2** — `lib/orphan-prune-reaper.js` |
| **REL-04** | P0 | **No proven auto-supervisor** | Orchestrator crash → bulk stops | Phase G — OPS-02/03; **04.2** stall detection in `ensure-bulk-running.sh` |
| **REL-05** | P1 | **No orchestrator heartbeat** | Can't tell stall vs slow from bulk log | **Guide 04.2** executed — `[heartbeat]` lines |
| **REL-06** | P1 | **No per-job wall clock** | `yarn start` unbounded runtime | **Guide 04.2** — `WORKER_MAX_RUNTIME_MS` |
| **REL-07** | P2 | **PTS/session drift** | 403s, UI timeouts | Cookie refresh + queue retry (mitigated, not eliminated) |

---

## Operational / supervision issues

| ID | P | Issue | Status | Dev guide / notes |
|----|---|-------|--------|-------------------|
| **OPS-01** | P0 | Bulk must start from **Terminal.app**, not Cursor shell | ✅ Documented `AGENTS.md` | — |
| **OPS-02** | P0 | No proven **auto-supervisor** (launchd watchdog unverified) | Open | Phase G — prove FDA path or remove |
| **OPS-03** | P0 | **macOS TCC** blocks launchd scripts in `~/Documents` | Open | Watchdog experimental only |
| **OPS-04** | P1 | **Stale locks** after killed orchestrator | Mitigated `bulk-lock.js` | `pipeline-health.sh --fix-locks` |
| **OPS-05** | P1 | **Multiple overlapping launchers** | Documented | Phase G consolidate |
| **OPS-06** | P1 | **No orchestrator heartbeat** in bulk log | **Fixed** Guide 04.2 | `[heartbeat]` in `orchestratorTick` |
| **OPS-07** | P2 | **Capture pass summary** not logged | Open | Guide 05 optional `cli.ts` line |

---

## Pipeline / throughput issues

| ID | P | Issue | Count / impact | Future work |
|----|---|-------|----------------|-------------|
| **PIPE-01** | P1 | **`needs_params` backlog** | **10** vehicles (was 54 at session start; capture retry **complete**) | 3 Excursions + E-Transit + 4 capture failures — see checkpoint |
| **PIPE-02** | P1 | **CDP lock contention** — long connector jobs starve capture first pass | 32 deferred → retry pass | By design (Guide 03); throughput tradeoff |
| **PIPE-03** | P2 | **`2016-f-250` connector slow/hang** | TCM C1750 ~9 min @ 99% CPU; recovered via INCOMPLETE→OK retry | REL-01 wall clock |
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
| **CODE-03** | P2 | **`bulk-orchestrator-lib.js` size** (~720 lines post-04.1) | `lib/` | Optional split with 04.2 |
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
| No unit tests / CI | 84 Vitest tests + `.github/workflows/test.yml` | Guide 02 + 04.1 + 04.2 |
| Orphan `downloading` on worker exit | `fixOrphanDownloading` in `reapWorkers` | Guide 04 — **extended by 04.1** `reapStaleWorkers` for `done: false` |
| Bulk orchestrator parallel stall (RUN-01) | Removed blocking orchestrator prune; PID stale reap | Guide 04.1 (`6c15180`) |
| `2016-f-250` connector interrupted (RUN-03) | INCOMPLETE → retry → OK post-04.1 | Session 2026-07-09 |
| `2018-expedition-max` 1 connector gap (RUN-04) | OK verified post-restart | Session 2026-07-09 |

---

## Capture failures this session (for matcher / retry tuning)

| Vehicle | Error class | Notes |
|---------|-------------|-------|
| `2003-f-250` | Workshop intercept miss | Borderline year |
| `2010-taurus` | `locator.waitFor` timeout | UI timing |
| `2009-crown-victoria` | PTS home `page.goto` 90s | CDP contention |
| `2012-escape` | Execution context destroyed | Navigation race |
| `2022-e-transit` | Model not in PTS menu | **PTS catalog gap** |
| `2023-e-transit` | Model not in PTS menu | Same |
| `2024-e-transit` | Model not in PTS menu | Same |

**Captured OK (15 net this session):** `2009-navigator`, `2009-flex`, `2010-navigator`, `2010-fusion`, `2011-navigator`, `2011-edge`, `2011-fiesta`, `2012-edge`, `2012-fusion`, `2012-taurus`, `2012-fiesta`, `2012-flex`, `2013-edge`, `2013-fiesta`, `2014-edge`

---

## Future dev guides

| Track | Scope | Priority |
|-------|-------|----------|
| **Guide 04.2** | Unsupervised reliability — hung reap, heartbeat, orphan prune, capture exit, watchdog stall detect | **P0** — **executed** (2026-07-09) |
| **Guide 05** | Capture modularization | P1 — implementation-ready |
| **Guide 06** | Pre-2003 legacy capture | After 05 + `legacy_pts_capture.md` filled |
| **Phase G** | Watchdog, pre-commit, health consolidation | Post-subscription or maintenance window |
| **Guide 07** (not authored) | E-Transit PTS availability / alternate capture path | If tier-1 blocked |

---

## Open questions (operator decisions)

1. **Watchdog:** Prove launchd (OPS-02) vs accept Terminal-only supervision?
2. **Tier-1 incomplete policy:** Always gap-retry vs accept `incomplete` and move on?
3. **E-Transit:** Skip tier-1, manual params, or alternate PTS navigation (RUN-06)?
4. **Worker timeouts (04.2):** Defaults `WORKER_LOG_STALE_MS=20m`, `WORKER_MAX_RUNTIME_MS=4h` — see 04.2 pass 2
5. ~~**Guide 05 vs 04.2 order**~~ → **04.2 first** (unsupervised bulk P0); 05 after capture stopped

---

## Changelog

| Date | Update |
|------|--------|
| 2026-07-09 | Guide 04.2 executed — unsupervised reliability; 84 tests |
| 2026-07-09 | Guide 04.1 executed — RUN-01 fix deployed; 75 tests |

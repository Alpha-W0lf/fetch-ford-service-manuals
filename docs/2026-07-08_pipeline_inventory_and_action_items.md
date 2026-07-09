# Ford PTS bulk pipeline — inventory & action items

**Date:** 2026-07-08  
**Repo:** `Alpha-W0lf/fetch-ford-service-manuals` (fork) — **never push to `upstream`** (`iamtheyammer/...`)  
**Subscription window:** ~72 hours; prioritize tier-1 anchors and trucks/commercial  
**Guidance applied:** `second_brain/docs/guides/best_practices_ai_native_engineering.md` (simplicity, guardrails, anti-bloat), `best_practices_pr_descriptions_git_workflow.md` (atomic commits, fork-only push), `prompt_work_session_standards.md` (inventory before more patches)

**Related docs:** `AGENTS.md`, `docs/PIPELINE_OPS.md`, `docs/reference/architecture.md`, `BULK_DOWNLOAD_GUIDE.md`, `docs/pipeline-scheduling.md`, [known_issues_and_backlog.md](./known_issues_and_backlog.md) (canonical issue registry), [2026-07-09_pipeline_session_checkpoint.md](./2026-07-09_pipeline_session_checkpoint.md) (**latest**)

---

## Session summary (2026-07-09 — Guide 04.1)

| Event | Detail |
|-------|--------|
| **RUN-01 fix** | Guide 04.1 implemented (`6c15180`) — removed blocking orchestrator prune; PID stale reap |
| **Recovery** | Stalled pid 28011 stopped; reconcile; restart pid **33628** at 23:36 |
| **Soak** | Early positive — OK/INCOMPLETE/OK rotation; new dispatches; no orchestrator freeze |
| **Reliability gap** | Hung-**alive** workers (REL-01) — next engineering target (Guide 04.2) |
| **Capture** | Retry pass complete; `needs_params` **10**; process zombie (REL-02) |

Full context: [2026-07-09_pipeline_session_checkpoint.md](./2026-07-09_pipeline_session_checkpoint.md)

---

## Session summary (what actually broke — 2026-07-08)

| Symptom | Root cause | Class |
|---------|------------|-------|
| Bulk dies ~1–2 min after start | Started from **Cursor/agent shell**; process group killed on session end | **Supervision** (not download logic) |
| `flock: command not found` | macOS stock PATH has no `flock` | **Platform assumption** |
| Stale `bulk-download.lock` | Orchestrator killed without `EXIT` trap | Symptom of supervision failure |
| launchd watchdog errors | macOS TCC blocks launchd executing scripts in `~/Documents` | **Platform permissions** |
| 15 bulk log files in one day | Repeated restarts without fixing start path | **Whack-a-mole** |

**What fixed stability:** `./scripts/start-bulk-in-terminal.sh` → Terminal.app → `caffeinate` + `nohup` → orchestrator **PPID=1**, multi-hour run with 2 workers.

---

## Current pipeline status (checkpoint)

Check live: `./scripts/queue-status.sh --health`

| Metric | Last known (2026-07-09 ~00:00) |
|--------|--------------------------------|
| Orchestrator | **Running** pid **33628** (post–04.1 restart ~23:36) |
| Workers | **2 active** — `2018-f-250`, `2019-f-250` (workshop) |
| Complete | **61** |
| Tier 1 | **35/38** |
| needs_params | **10** (capture retry complete) |
| Param capture | Retry pass **done**; pid **29405** idle zombie (REL-02) |

**Issue registry:** [known_issues_and_backlog.md](./known_issues_and_backlog.md) — RUN-01 fixed; REL-* unsupervised gaps

**Latest checkpoint:** [2026-07-09_pipeline_session_checkpoint.md](./2026-07-09_pipeline_session_checkpoint.md)

**Runtime notes (prior):** [2026-07-08_pipeline_runtime_observations.md](./2026-07-08_pipeline_runtime_observations.md)

### Prior checkpoint (2026-07-08 ~22:48 — superseded)

| Metric | Value |
|--------|-------|
| Orchestrator | pid 28011 — **stalled** (RUN-01) |
| Workers | 0 |
| Complete | 59 |
| needs_params | 40 |

### Restart procedure (2026-07-08 ~21:14)

1. PTS Chrome CDP `:9222` — up
2. `./scripts/start-bulk-in-terminal.sh` — Terminal.app → bulk via `caffeinate` + Node orchestrator
3. `./scripts/start-capture-in-terminal.sh` — second Terminal → `run-capture-params.sh --all`
4. Guide 04 soak **in progress** — orchestrator healthy; workers dispatching and completing

### Observations

**Healthy:**
- Capture: **15 vehicles** params captured this session; on **CDP retry pass** (32 deferred); actively OK'ing (`2014-edge` latest)
- CDP coordination: defer/retry working; capture holds CDP lock during retry pass

**Watch / act:**
- **Bulk stall (RUN-01):** Orchestrator alive but no `yarn start` workers; queue stuck `downloading` for `2016-f-250` / `2018-expedition-max` — likely hung `prune-cdp-tabs` blocking `runOne` completion — see [known_issues_and_backlog.md](./known_issues_and_backlog.md)
- **Hung prune processes (RUN-02):** Multiple `prune-cdp-tabs.ts` PIDs; kill orphans or restart bulk
- **E-Transit capture fails:** PTS menu lacks E-Transit for 2022/23 — not fixed by `modelMatchers` alone
- **Chrome error tabs** — expected under PTS load
- **19 `failed`** — stable; auto-retry when bulk dispatches again

---

## Prioritized action items

Priority: **P0** = blocks subscription goals · **P1** = reliability/maintainability · **P2** = nice-to-have

| P | Item | Why | Complexity | Risk if deferred | Risk if done wrong | Status |
|---|------|-----|------------|------------------|-------------------|--------|
| **P0** | **Never start bulk from Cursor terminal**; use `./scripts/start-bulk-in-terminal.sh` | Only proven stable supervisor path | Low | Bulk stops; lost download hours | None | ✅ Documented |
| **P0** | Keep PTS Chrome open (`:9222`) + Mac plugged in | Connectors + cookie refresh | Low | Connector/auth failures | None | Ongoing |
| **P0** | **Unsupervised reliability (REL-01)** — hung-alive worker wall clock + log stale reap | Worker can block slot hours while alive | Medium | Wasted subscription hours | Wrong kill threshold | **Guide 04.2** — **executed** 2026-07-09 |
| **P0** | Run param capture in parallel | Drain needs_params | Medium | 10 still blocked | CDP contention | **Retry pass done** — REL-02 clean exit |
| **P1** | **E-Transit capture** — PTS menu missing model for 2022/23 | Tier-1 blocked; matchers insufficient | Medium | 3 tier-1 vehicles | Wrong workaround | **Open — RUN-06** |
| **P1** | **Pre-2003 automated capture** (not manual DevTools) | 3 vehicles now; fleet will grow | Medium | Pre-2003 stays blocked | Scope creep mid-sprint | **Backlog — Guide 06** |
| **P1** | Prove or remove launchd watchdog | Experimental; TCC issues | Medium | No auto-restart overnight | Spurious Terminal tabs | Open |
| **P1** | Foundation docs + dev guides | Maintainability | Low | Drift continues | None | **Guides 01–04 executed; 05 ready** |
| **P1** | Split `bulk-download.sh` | Maintainability | Medium | Harder debugging | Break running pipeline | **Done (Guide 04)** |
| **P1** | Retry `2011-f-450` gap-fill | Tier-1 incomplete | Low | Missing pages | Queue time | Auto when slot free |
| **P1** | Commit/push frequently to **origin only** | Checkpoints | Low | Lost history | Accidental upstream push | Ongoing |
| **P2** | Remove duplicate cookie refresh at worker start | Simpler starts | Low | Slower restarts | Auth edge case | **Defer until bulk stops** |
| **P2** | Orchestrator heartbeat + capture pass summary logging | Debug long runs without vehicle log tail | Low | Harder ops triage | Log volume | Open — see runtime observations doc |
| **P2** | Consolidate start paths in docs | Consistency | Low | Confusion | None | ✅ Done |
| **P2** | `AGENTS.md` repo guardrails | Prevent AI slop | Medium | Over-engineering | Instruction drift | ✅ Done |
| **P2** | Uninstall watchdog after subscription | Cleanup | Low | Leftover launchd | None | Post-subscription |

---

## Tech debt inventory

**Canonical registry:** [known_issues_and_backlog.md](./known_issues_and_backlog.md)

### Fixed (pushed to origin)

- [x] Replace broken `flock` with `scripts/bulk-lock.js` (macOS-portable, stale PID cleanup)
- [x] Double-detach `start-bulk-download.sh`
- [x] `start-bulk-in-terminal.sh` (Terminal.app only)
- [x] `ensure-bulk-running.sh` + `install-bulk-watchdog.sh` (experimental)
- [x] `SKIP_BACKFILL_ON_START=1` default (faster restarts)
- [x] `pipeline-health.sh` lock dir handling
- [x] `docs/pipeline-scheduling.md` lock section corrected
- [x] `BULK_DOWNLOAD_GUIDE.md` — Terminal start, health, param capture
- [x] `AGENTS.md` — architecture invariants
- [x] `install-bulk-watchdog.sh` log path echo

### Open / unresolved

| Debt | Severity | Notes |
|------|----------|-------|
| **Bulk orchestrator stall (RUN-01)** | ~~High~~ | **Fixed** Guide 04.1 |
| **Hung-alive worker (REL-01)** | **High** | No wall clock; 2016 TCM episode |
| **Capture zombie (REL-02)** | Medium | Process idle after session done |
| **No proven auto-supervisor** | High | Watchdog unverified; Terminal start is the real fix |
| **40 needs_params** | ~~High~~ | **10** remaining — see checkpoint |
| **E-Transit PTS availability (RUN-06)** | Medium | Model absent from PTS menu — not matcher issue |
| **Pre-2003 capture automation** | Medium | Guide 06 — 3 vehicles |
| **`2011-f-450` incomplete** | Medium | Tier-1 gaps |
| **capture-params monolith** | Medium | Guide 05 |
| **Orchestrator observability** | Low | Heartbeat, pass summary — Phase G |

---

## Architecture invariants (do not violate)

1. **Long runs:** Terminal.app or proven detached process (PPID=1). Never Cursor agent background shell.
2. **One bulk orchestrator** at a time (`bulk-lock.js`).
3. **CDP mutex** only for connector capture vs param capture — not for headless workshop/wiring.
4. **Push to `origin` only** — fork `Alpha-W0lf/fetch-ford-service-manuals`.
5. **Simplicity over new ops features** until bulk runs 12+ hours without intervention.
6. **Do not restart bulk** to pick up doc-only or non-orchestrator code changes.

---

## CDP coordination (2026-07-08 — reference frozen in Guide 01)

| Behavior | Detail |
|----------|--------|
| Bulk connector lock | **Per connector** (`withCdpChromeLock`), not whole vehicle |
| Capture lock | **Per vehicle** during navigation; released in `finally` |
| Capture yield | `CDP_LOCK_YIELD_MS` (120s) → defer to retry pass if bulk busy |
| Tab prune incident | Aggressive prune closed live connector tab on `2018-f-550` — fixed: safe prune only |
| Canonical docs | `docs/reference/architecture.md`, `docs/reference/schemas.md` |

---

## Git remotes (verify before every push)

```
origin   → https://github.com/Alpha-W0lf/fetch-ford-service-manuals.git  (PUSH HERE)
upstream → https://github.com/iamtheyammer/fetch-ford-service-manuals.git (fetch only)
```

---

## Open questions

1. Should launchd watchdog be finished (FDA grant / different launcher) or removed until post-subscription?
2. Accept `incomplete` for fill years and move on, or always gap-retry tier-1?
3. Pre-2003 automation design: **single legacy branch in `src/capture/`** (Guide 06) — exploration doc required first

## Pre-2003 automation (explicit backlog)

**Policy:** No manual DevTools workflow — pre-2003 vehicles must be captured automatically like the rest of the fleet.

**Current state:** `capture-params.ts` only implements the 2003+ year/model → VIN → Workshop/Wiring intercept flow. `--include-legacy` queues pre-2003 vehicles but does not implement capture. Placeholder `pre_2003.alphabeticalIndexURL` in generated params is not valid.

**Future implementation (post-subscription or when queue is unblocked):**

1. Detect `modelYear < 2003` in `capture-params.ts`
2. Navigate Workshop → select manual → capture real Alphabetical Index URL
3. Capture wiring params via existing network intercept
4. Reuse `src/pre-2003/` download path in `yarn start`

**Queue today:** 3 pre-2003 vehicles (`2000-excursion`, `2001-excursion`, `2002-excursion`). Correctly deprioritized while modern `needs_params` remain.

**Guide 06:** Expanded plan + exploration template `docs/reference/legacy_pts_capture.md` — **not implementation-ready** until operator fills exploration.

---

## Changelog (this doc)

| Date | Update |
|------|--------|
| 2026-07-08 | Initial inventory after supervision root-cause session |
| 2026-07-08 | Checkpoint ~18:00 — 55 complete, tier 1 31/38; docs + AGENTS.md |
| 2026-07-08 | Dev Guide 01 — `docs/reference/*`, `PIPELINE_OPS.md`, CDP docs aligned |
| 2026-07-08 | Guide 04 executed; runtime observations; checkpoint ~22:07 |
| 2026-07-08 | Guide 06 plan pass; `legacy_pts_capture.md` template |
| 2026-07-09 | Guide 04.1 executed; checkpoint doc; REL gaps; 04.2 outline |

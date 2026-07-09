# Ford PTS bulk pipeline — inventory & action items

**Date:** 2026-07-08  
**Repo:** `Alpha-W0lf/fetch-ford-service-manuals` (fork) — **never push to `upstream`** (`iamtheyammer/...`)  
**Subscription window:** ~72 hours; prioritize tier-1 anchors and trucks/commercial  
**Guidance applied:** `second_brain/docs/guides/best_practices_ai_native_engineering.md` (simplicity, guardrails, anti-bloat), `best_practices_pr_descriptions_git_workflow.md` (atomic commits, fork-only push), `prompt_work_session_standards.md` (inventory before more patches)

**Related docs:** `AGENTS.md`, `docs/PIPELINE_OPS.md`, `docs/reference/architecture.md`, `BULK_DOWNLOAD_GUIDE.md`, `docs/pipeline-scheduling.md`, `docs/dev_guides/2026-07-08_dev_guide_01_architecture_reference.md`

---

## Session summary (what actually broke)

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

| Metric | Last known (2026-07-08 ~21:32) |
|--------|--------------------------------|
| Orchestrator | **Running** — Node `bulk-orchestrator.js` pid **28011** |
| Workers | **2** — `2016-f-250` (wiring, ~1982 log lines), `2018-expedition-max` (workshop PDFs) |
| Complete | **59** (`2018-f-550`, `2004-f-150` this session) |
| Tier 1 | **35/38** |
| Failed | **19** (auth burst ~02:29 UTC — see below) |
| needs_params | **50** (−4 from capture OKs) |
| Param capture | **Running** — 4 OK this session; on `2010-taurus` |

### Restart procedure (2026-07-08 ~21:14)

1. PTS Chrome CDP `:9222` — up
2. `./scripts/start-bulk-in-terminal.sh` — Terminal.app → bulk via `caffeinate` + Node orchestrator
3. `./scripts/start-capture-in-terminal.sh` — second Terminal → `run-capture-params.sh --all`
4. Guide 04 soak **in progress** — orchestrator healthy; workers dispatching and completing

### Observations

**Healthy:**
- Bulk: `2004-f-150` → complete; `2018-f-550` connectors → complete; 2 workers actively downloading (`2016-f-250`, `2018-expedition-max`)
- Capture: CDP lock held; 4 vehicles captured (`2009-flex`, `2009-navigator`, `2010-navigator`, `2010-fusion`); E-Transit deferred to retry pass (expected during connector job)
- CDP coordination: defer/retry working as designed

**Watch (not blocking yet):**
- **~02:29 UTC auth burst:** 14+ vehicles failed fast with HTTP 403 (F-250, Transit, Ranger, Maverick, Expedition). Cookie refresh fires after each; workers recovered and long jobs continue. Likely cookie/session contention while capture + bulk headless overlapped. Failed vehicles **will retry** via queue rank.
- `2003-f-250` capture: workshop intercept miss (1 vehicle, edge year)

**No incident file** — monitor for sustained 403s; re-login PTS Chrome if failures continue after cookie refresh.

---

## Prioritized action items

Priority: **P0** = blocks subscription goals · **P1** = reliability/maintainability · **P2** = nice-to-have

| P | Item | Why | Complexity | Risk if deferred | Risk if done wrong | Status |
|---|------|-----|------------|------------------|-------------------|--------|
| **P0** | **Never start bulk from Cursor terminal**; use `./scripts/start-bulk-in-terminal.sh` | Only proven stable supervisor path | Low | Bulk stops; lost download hours | None | ✅ Documented |
| **P0** | Keep PTS Chrome open (`:9222`) + Mac plugged in | Connectors + cookie refresh | Low | Connector/auth failures | None | Ongoing |
| **P0** | Run param capture in parallel (`./scripts/start-capture-in-terminal.sh`) in 2nd Terminal | 54 vehicles still blocked | Medium | Can't drain full queue | CDP contention (lock mitigates) | **Running** |
| **P1** | **E-Transit `modelMatchers` fix** (`capture-params.ts`) | `2022/23/24-e-transit` fail: menu label mismatch | Low | 3 tier-1 vehicles blocked | Wrong alias if PTS label differs | **Fixed in code — restart capture to pick up** |
| **P1** | **Pre-2003 automated capture** (not manual DevTools) | 3 vehicles now; fleet will grow | Medium | Pre-2003 stays blocked | Scope creep mid-sprint | **Backlog — defer during subscription** |
| **P1** | Prove or remove launchd watchdog | Experimental; TCC issues | Medium | No auto-restart overnight | Spurious Terminal tabs | Open |
| **P1** | Foundation docs + dev guides | Maintainability; freeze contracts before tests | Low | Drift continues | None | **Guide 01 complete** — Guide 02 next |
| **P1** | Split `bulk-download.sh` (~500 lines) | Maintainability | Medium | Harder debugging | Break running pipeline | **Done (Guide 04)** — soak pending |
| **P1** | Retry `2011-f-450` gap-fill | Tier-1 incomplete | Low | Missing pages | Queue time | Auto when slot free |
| **P1** | Commit/push frequently to **origin only** | Checkpoints | Low | Lost history | Accidental upstream push | Ongoing |
| **P2** | Remove duplicate cookie refresh at worker start | Simpler starts | Low | Slower restarts | Auth edge case | **Defer until bulk stops** |
| **P2** | Demote idle PDF spot-check / periodic reconcile to opt-in | Simpler hot loop | Low | Less drift detection | Miss corrupt PDFs | **Defer until bulk stops** |
| **P2** | Consolidate start paths in docs | Consistency | Low | Confusion | None | ✅ Done |
| **P2** | `AGENTS.md` repo guardrails | Prevent AI slop | Medium | Over-engineering | Instruction drift | ✅ Done |
| **P2** | Uninstall watchdog after subscription | Cleanup | Low | Leftover launchd | None | Post-subscription |

---

## Tech debt inventory

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
| **No proven auto-supervisor** | High | Watchdog unverified; Terminal start is the real fix |
| **504-line bash orchestrator** | Medium | Split after bulk run ends |
| **Lock patterns** (bulk + CDP) | Low | Per-connector CDP lock + capture yield documented in `docs/reference/` |
| **Duplicate `~/bin/ford-bulk-watchdog.sh`** | Low | Re-run install after `ensure-bulk-running.sh` changes |
| **54 needs_params** | High (throughput) | Param capture running; restart after capture code changes |
| **E-Transit naming** | Medium | `modelMatchers` + regex fallback in `capture-params.ts`; verify on next capture pass |
| **Pre-2003 capture automation** | Medium | Must automate eventually (`pre_2003.alphabeticalIndexURL` branch); not manual — 3 vehicles deferred |
| **PTS `subscriptionExpired` false alarm** | Medium | Stale session recovery in `ptsAuth.ts` + `recover-pts-chrome-session.js` (pushed `0fe1a35`) |
| **`2011-f-450` incomplete** | Medium | 2054 PDFs; gaps remain |
| **`2018-f-550` auth retry** | Watch | Circuit breaker tripped once; retry in progress |

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
3. Pre-2003 automation design: single `capture-params` branch vs dedicated legacy script?

## Pre-2003 automation (explicit backlog)

**Policy:** No manual DevTools workflow — pre-2003 vehicles must be captured automatically like the rest of the fleet.

**Current state:** `capture-params.ts` only implements the 2003+ year/model → VIN → Workshop/Wiring intercept flow. `--include-legacy` queues pre-2003 vehicles but does not implement capture. Placeholder `pre_2003.alphabeticalIndexURL` in generated params is not valid.

**Future implementation (post-subscription or when queue is unblocked):**

1. Detect `modelYear < 2003` in `capture-params.ts`
2. Navigate Workshop → select manual → capture real Alphabetical Index URL
3. Capture wiring params via existing network intercept
4. Reuse `src/pre-2003/` download path in `yarn start`

**Queue today:** 3 pre-2003 vehicles (years 2000–2002). Correctly deprioritized while 54 modern `needs_params` remain.

---

## Changelog (this doc)

| Date | Update |
|------|--------|
| 2026-07-08 | Initial inventory after supervision root-cause session |
| 2026-07-08 | Checkpoint ~18:00 — 55 complete, tier 1 31/38; docs + AGENTS.md |
| 2026-07-08 | Dev Guide 01 — `docs/reference/*`, `PIPELINE_OPS.md`, CDP docs aligned |

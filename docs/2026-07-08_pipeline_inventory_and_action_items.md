# Ford PTS bulk pipeline — inventory & action items

**Date:** 2026-07-08  
**Repo:** `Alpha-W0lf/fetch-ford-service-manuals` (fork) — **never push to `upstream`** (`iamtheyammer/...`)  
**Subscription window:** ~72 hours; prioritize tier-1 anchors and trucks/commercial  
**Guidance applied:** `second_brain/docs/guides/best_practices_ai_native_engineering.md` (simplicity, guardrails, anti-bloat), `best_practices_pr_descriptions_git_workflow.md` (atomic commits, fork-only push), `prompt_work_session_standards.md` (inventory before more patches)

**Related docs:** `AGENTS.md`, `BULK_DOWNLOAD_GUIDE.md`, `docs/pipeline-scheduling.md`

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

| Metric | Last known (2026-07-08 ~18:00) |
|--------|--------------------------------|
| Orchestrator | Running (pid 91430, **PPID=1**, ~1h48m+ uptime) |
| Workers | **2** parallel |
| Complete | **55** |
| Tier 1 | **31/38** |
| Incomplete | 1 (`2011-f-450` — gaps on disk) |
| Pending | 161 |
| needs_params | 75 |
| Param capture | **Running** (Terminal; `logs/capture-params-20260708-1811.log`) |

**Recently completed this run:** `2018-f-350`, `2018-f-450`, `2011-f-550` (verified).

**Active (last check):** `2010-e-series`, `2018-f-550` (retry after auth failure; circuit breaker refreshed cookies).

**Recommendation:** **Do not stop or relaunch** while healthy. Restart only if orchestrator down or 0 workers for >10 minutes.

---

## Prioritized action items

Priority: **P0** = blocks subscription goals · **P1** = reliability/maintainability · **P2** = nice-to-have

| P | Item | Why | Complexity | Risk if deferred | Risk if done wrong | Status |
|---|------|-----|------------|------------------|-------------------|--------|
| **P0** | **Never start bulk from Cursor terminal**; use `./scripts/start-bulk-in-terminal.sh` | Only proven stable supervisor path | Low | Bulk stops; lost download hours | None | ✅ Documented |
| **P0** | Keep PTS Chrome open (`:9222`) + Mac plugged in | Connectors + cookie refresh | Low | Connector/auth failures | None | Ongoing |
| **P0** | Run param capture in parallel (`./scripts/start-capture-in-terminal.sh`) in 2nd Terminal | 75 vehicles blocked | Medium | Can't drain full queue | CDP contention (lock mitigates) | **Running** |
| **P1** | Prove or remove launchd watchdog | Experimental; TCC issues | Medium | No auto-restart overnight | Spurious Terminal tabs | Open |
| **P1** | Update `BULK_DOWNLOAD_GUIDE.md` | Single ops doc | Low | Repeat mis-starts | Doc drift | ✅ Done |
| **P1** | Split `bulk-download.sh` (~500 lines) | Maintainability | Medium | Harder debugging | Break running pipeline | **Defer until bulk stops** |
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
| **Lock patterns** (bulk + CDP) | Low | Documented in `AGENTS.md`; freeze |
| **Duplicate `~/bin/ford-bulk-watchdog.sh`** | Low | Re-run install after `ensure-bulk-running.sh` changes |
| **75 needs_params** | High (throughput) | Start param capture in 2nd Terminal |
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

## Git remotes (verify before every push)

```
origin   → https://github.com/Alpha-W0lf/fetch-ford-service-manuals.git  (PUSH HERE)
upstream → https://github.com/iamtheyammer/fetch-ford-service-manuals.git (fetch only)
```

---

## Open questions

1. Should launchd watchdog be finished (FDA grant / different launcher) or removed until post-subscription?
2. Run param capture overnight in second Terminal window?
3. Accept `incomplete` for fill years and move on, or always gap-retry tier-1?

---

## Changelog (this doc)

| Date | Update |
|------|--------|
| 2026-07-08 | Initial inventory after supervision root-cause session |
| 2026-07-08 | Checkpoint ~18:00 — 55 complete, tier 1 31/38; docs + AGENTS.md |

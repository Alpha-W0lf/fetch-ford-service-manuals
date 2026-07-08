# Ford PTS bulk pipeline — inventory & action items

**Date:** 2026-07-08  
**Repo:** `Alpha-W0lf/fetch-ford-service-manuals` (fork) — **never push to `upstream`** (`iamtheyammer/...`)  
**Subscription window:** ~72 hours; prioritize tier-1 anchors and trucks/commercial  
**Guidance applied:** `second_brain/docs/guides/best_practices_ai_native_engineering.md` (simplicity, guardrails, anti-bloat), `best_practices_pr_descriptions_git_workflow.md` (atomic commits, fork-only push), `prompt_work_session_standards.md` (inventory before more patches)

---

## Session summary (what actually broke)

| Symptom | Root cause | Class |
|---------|------------|-------|
| Bulk dies ~1–2 min after start | Started from **Cursor/agent shell**; process group killed on session end | **Supervision** (not download logic) |
| `flock: command not found` | macOS stock PATH has no `flock` | **Platform assumption** |
| Stale `bulk-download.lock` | Orchestrator killed without `EXIT` trap | Symptom of supervision failure |
| launchd watchdog errors | macOS TCC blocks launchd executing scripts in `~/Documents` | **Platform permissions** |
| 15 bulk log files in one day | Repeated restarts without fixing start path | **Whack-a-mole** |

**What fixed stability:** `./scripts/start-bulk-in-terminal.sh` → Terminal.app → `caffeinate` + `nohup` → orchestrator **PPID=1**, **~1+ hour** continuous run with 2 workers.

---

## Current pipeline status (checkpoint)

Check live: `./scripts/queue-status.sh --health`

| Metric | Last known (2026-07-08 ~17:20) |
|--------|--------------------------------|
| Orchestrator | Running (Terminal `s022`, pid 91430) |
| Workers | 2 parallel |
| Complete | 53 (+1: `2018-f-350` verified) |
| Tier 1 | 29/38 |
| Incomplete | 1 (`2011-f-450` — gaps on disk) |
| Pending | 163 |
| needs_params | 75 |
| Param capture | Not running |

**Active work:** `2018-f-450` (connectors), `2011-f-550` (just started after `2018-f-350` completed).

**Recommendation:** **Do not stop or relaunch** while healthy. Restart only if health shows orchestrator down or 0 workers for >10 minutes.

---

## Prioritized action items

Priority: **P0** = blocks subscription goals · **P1** = reliability/maintainability · **P2** = nice-to-have

| P | Item | Why | Complexity | Risk if deferred | Risk if done wrong |
|---|------|-----|------------|------------------|-------------------|
| **P0** | **Never start bulk from Cursor terminal**; use `./scripts/start-bulk-in-terminal.sh` | Only proven stable supervisor path | Low | Bulk stops; lost download hours | None |
| **P0** | Keep PTS Chrome open (`:9222`) + Mac plugged in | Connectors + cookie refresh | Low | Connector/auth failures | None |
| **P0** | Run param capture in parallel (`./scripts/run-capture-params.sh`) when at keyboard | 75 vehicles blocked without `params.json` | Medium | Can't drain full queue | CDP contention with bulk (mitigated by per-vehicle lock) |
| **P1** | Prove or remove launchd watchdog | Currently experimental; TCC issues | Medium | No auto-restart overnight | Spurious Terminal tabs every 5 min |
| **P1** | Update `BULK_DOWNLOAD_GUIDE.md` — Terminal start, lock, watchdog | Single ops doc; reduce confusion | Low | Repeat mis-starts | Doc drift |
| **P1** | Split `bulk-download.sh` (~500 lines) — supervisor vs `run_one` | Maintainability | Medium | Harder debugging | Break running pipeline |
| **P1** | Retry `2011-f-450` gap-fill when slot free | Tier-1 anchor incomplete | Low | Missing pages for that year | Time in queue |
| **P1** | Commit/push frequently to **origin only** | Checkpoints; recoverability | Low | Lost work history | Accidental upstream push (verify remote) |
| **P2** | Remove duplicate cookie refresh at worker start (3× at boot) | Simpler, faster starts | Low | Slightly slower per-vehicle | Auth edge case |
| **P2** | Demote idle PDF spot-check / periodic reconcile to opt-in | Simpler hot loop | Low | Less automatic drift detection | Miss corrupt PDFs |
| **P2** | Consolidate start paths (3 scripts → documented hierarchy) | Consistency | Low | Confusion | None |
| **P2** | `AGENTS.md` for repo — Intent Architect rules for this project | Prevent future AI slop | Medium | Repeated over-engineering | Instruction drift |
| **P2** | Uninstall watchdog after subscription: `./scripts/install-bulk-watchdog.sh --uninstall` | Cleanup | Low | Leftover launchd job | None |

---

## Tech debt inventory

### Fixed this session (in git, pending push)

- [x] Replace broken `flock` with `scripts/bulk-lock.js` (macOS-portable, stale PID cleanup)
- [x] Double-detach `start-bulk-download.sh`
- [x] `start-bulk-in-terminal.sh` (Terminal.app only)
- [x] `ensure-bulk-running.sh` + `install-bulk-watchdog.sh` (experimental)
- [x] `SKIP_BACKFILL_ON_START=1` default (faster restarts)
- [x] `pipeline-health.sh` lock dir handling
- [x] `docs/pipeline-scheduling.md` lock section corrected

### Open / unresolved

| Debt | Severity | Notes |
|------|----------|-------|
| **No proven auto-supervisor** | High | Watchdog unverified; manual Terminal start is the real fix |
| **504-line bash orchestrator** | Medium | Circuit breaker + maintenance + workers in one file |
| **Three lock patterns** (bulk mkdir, CDP chrome, historical flock commit) | Medium | Document once; freeze patterns |
| **Duplicate `~/bin/ford-bulk-watchdog.sh`** | Low | Copied on install; can drift from repo — reinstall syncs |
| **BULK_DOWNLOAD_GUIDE outdated** | Medium | Still references old parallel start; no Terminal rule |
| **75 needs_params** | High (throughput) | Separate pipeline; PTS timeouts seen in capture logs |
| **`2011-f-450` incomplete** | Medium | 2054 PDFs; gaps remain |
| **Previous commit message lies** (`9d98056` says flock works) | Low | This push corrects that |

---

## Architecture invariants (do not violate)

1. **Long runs:** Terminal.app or proven detached process (PPID=1). Never Cursor agent background shell.
2. **One bulk orchestrator** at a time (`bulk-lock.js`).
3. **CDP mutex** only for connector capture vs param capture — not for headless workshop/wiring.
4. **Push to `origin` only** — fork `Alpha-W0lf/fetch-ford-service-manuals`.
5. **Simplicity over new ops features** until bulk runs 12+ hours without intervention.

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

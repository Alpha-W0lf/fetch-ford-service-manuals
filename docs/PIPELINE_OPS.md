# Pipeline operations — Ford PTS bulk download

**Operator index** for this repo. Canonical architecture lives in [reference/architecture.md](./reference/architecture.md) — do not duplicate lock/status rules here.

---

## Quick start (subscription window)

1. **PTS Chrome:** `./scripts/launch-pts-chrome.sh` — log in, keep `:9222` up.
2. **Bulk:** `./scripts/start-bulk-in-terminal.sh` (Terminal.app — not Cursor).
3. **Param capture** (second Terminal): `./scripts/start-capture-in-terminal.sh`.
4. **Health:** `./scripts/queue-status.sh --health`.

Mac plugged in; cookies refresh automatically (~3h) while bulk runs.

---

## Document map

| Doc | Use when |
|-----|----------|
| [2026-07-08_pipeline_runtime_observations.md](./2026-07-08_pipeline_runtime_observations.md) | Why Chrome looks idle, session progress, known issues |
| [reference/architecture.md](./reference/architecture.md) | Understanding components, locks, data flow |
| [reference/queue_state_machine.md](./reference/queue_state_machine.md) | Queue statuses, who writes what |
| [reference/schemas.md](./reference/schemas.md) | JSON contracts, gap blocking rules |
| [reference/env_vars.md](./reference/env_vars.md) | Tuning timeouts, parallelism, hybrid-complete |
| [pipeline-scheduling.md](./pipeline-scheduling.md) | Scheduling, maintenance intervals, verification |
| [BULK_DOWNLOAD_GUIDE.md](../BULK_DOWNLOAD_GUIDE.md) | Strategy, throughput, troubleshooting |
| [2026-07-08_pipeline_inventory_and_action_items.md](./2026-07-08_pipeline_inventory_and_action_items.md) | Open items, incident root causes |
| [AGENTS.md](../AGENTS.md) | AI agent invariants |

---

## Bulk orchestrator (Node)

Entry: `./scripts/start-bulk-in-terminal.sh` → `bulk-download.sh` (lock + trap) → `scripts/bulk-orchestrator.js`.

Logic lives in `lib/bulk-orchestrator-lib.js` (tested). Do not start orchestrator from Cursor/agent shells.

**Stall symptoms (RUN-01):** orchestrator pid alive, `yarn workers: 0`, queue rows stuck `downloading` — **fixed** Guide 04.1 (`6c15180`). If recurrence: see [investigation](./2026-07-09_bulk_stall_root_cause_investigation.md). Hung-**alive** workers: [REL-01](./known_issues_and_backlog.md) — **fixed** Guide 04.2 (2026-07-09).

---

| Task | Command |
|------|---------|
| Bulk | `./scripts/start-bulk-in-terminal.sh` |
| Bulk (in Terminal already) | `SKIP_BACKFILL_ON_START=1 ./scripts/start-bulk-download.sh` |
| Param capture | `./scripts/start-capture-in-terminal.sh` |
| Param capture (in Terminal) | `./scripts/run-capture-params.sh` |
| Health | `./scripts/queue-status.sh --health` |
| Stale locks only | `./scripts/pipeline-health.sh --fix-locks` |
| Reconcile queue | `node scripts/reconcile-queue.js` |
| Cookie export | `node scripts/export-cookies-from-chrome.js` |

---

## Do not

- Start bulk from **Cursor/agent** background shells (process group dies ~1–2 min).
- Use `flock` for locking (not on stock macOS).
- Run `generate-vehicle-queue.js` on a queue with download progress (destroys statuses).
- Push to `upstream` (`iamtheyammer/fetch-ford-service-manuals`).
- Restart healthy bulk for doc-only changes.

---

## Fleet

~**295** vehicles after base queue (186) + expansion append (109). See [reference/architecture.md](./reference/architecture.md#queue-and-filesystem-state).

---

## Foundation work

Dev guides: [dev_guides/README.md](./dev_guides/README.md) — Guides 01–04.2 executed; 05–06 planned.

Context assessment: [2026-07-08_codebase_foundation_context_assessment.md](./2026-07-08_codebase_foundation_context_assessment.md).

---

`./scripts/install-bulk-watchdog.sh` — launchd every 5 min + at login. Restores crashed/stopped bulk via Terminal.app.

**2026-07-12 root causes (fixed):**
1. Installer copied `ensure-bulk-running.sh` into `~/bin` with relative `ROOT="$(dirname "$0")/.."` → `/Users/tom` → Terminal window storm.
2. Thin `exec` of a script under `~/Documents` from launchd → TCC `Operation not permitted` (exit 126).

**Fix:** TCC-safe `~/bin/ford-bulk-watchdog.sh` with **hardcoded absolute ROOT** (pgrep + osascript only; no Documents I/O from launchd); full stall checks remain in in-repo `ensure-bulk-running.sh` when run from Terminal/user shell; pause/cooldown/logs under `~/Library/Logs/`.

| Action | Command |
|--------|---------|
| Install / reinstall | `./scripts/install-bulk-watchdog.sh` |
| Uninstall | `./scripts/install-bulk-watchdog.sh --uninstall` |
| Intentional stop (keep agent) | `touch ~/Library/Logs/ford-bulk-watchdog.pause` |
| Resume auto-restart | `rm -f ~/Library/Logs/ford-bulk-watchdog.pause` |
| Logs | `~/Library/Logs/ford-bulk-watchdog.log` (and `logs/watchdog.log` when script runs with Documents access) |

Blessed **manual** start remains `./scripts/start-bulk-in-terminal.sh`. Re-run install after changing the installer/launcher template.

**Subscription gate:** If the Ford PTS subscription is inactive, keep the pause file present and do **not** start bulk/capture. Auto-restart must stay disabled until Tom renews and explicitly removes the pause / authorizes resume.

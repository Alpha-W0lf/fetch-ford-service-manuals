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

Dev guides: [dev_guides/README.md](./dev_guides/README.md) — Guide 01 executed; 02–06 plans only.

Context assessment: [2026-07-08_codebase_foundation_context_assessment.md](./2026-07-08_codebase_foundation_context_assessment.md).

---

## Experimental

`./scripts/install-bulk-watchdog.sh` — launchd auto-restart; **unproven** (macOS TCC issues). Terminal.app supervision is the proven path.

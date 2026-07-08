# Agent guidance — fetch-ford-service-manuals

**Fork:** push only to `origin` (`Alpha-W0lf/fetch-ford-service-manuals`). Never push to `upstream`.

## Architecture invariants

1. **Long-running bulk** must start from **Terminal.app** (`./scripts/start-bulk-in-terminal.sh`). Never start `bulk-download.sh` from Cursor/agent background shells — the process group is killed when the session ends.
2. **One bulk orchestrator** at a time (`scripts/bulk-lock.js`).
3. **CDP lock** (`scripts/cdp-chrome-lock.js`) serializes PTS Chrome between connector capture and param capture only. Headless workshop/wiring do not hold it.
4. **Simplicity over new ops features** while subscription bulk is running. Do not add circuit breakers, locks, or maintenance hooks without a root-cause justification.
5. **Smallest correct change.** Do not refactor `bulk-download.sh` during an active bulk run.

## Before changing ops scripts

Read:

- `docs/pipeline-scheduling.md` — process coordination
- `docs/2026-07-08_pipeline_inventory_and_action_items.md` — open items and known root causes
- `BULK_DOWNLOAD_GUIDE.md` — operator-facing start/stop

## Forbidden patterns

- `flock` for bulk locking (not on stock macOS)
- Starting bulk from IDE automation without Terminal.app detachment
- Pushing to `iamtheyammer/fetch-ford-service-manuals`
- Fleet-wide `backfill-capture-gaps.js` on every bulk boot (use `SKIP_BACKFILL_ON_START=1` default)

## Blessed start paths

| Task | Command |
|------|---------|
| Bulk (manual) | `./scripts/start-bulk-in-terminal.sh` |
| Bulk (if already in Terminal) | `SKIP_BACKFILL_ON_START=1 ./scripts/start-bulk-download.sh` |
| Param capture | `./scripts/start-capture-in-terminal.sh` (second Terminal) |
| Param capture (in Terminal already) | `./scripts/run-capture-params.sh` |
| Health | `./scripts/queue-status.sh --health` |

Watchdog (`./scripts/install-bulk-watchdog.sh`) is **experimental** — do not treat as proven supervision.

## Code organization

- **Orchestration:** `scripts/bulk-download.sh`, queue scripts (`queue-lib.js`, `reconcile-queue.js`)
- **Verification:** `verify-download-lib.js`, `capture-gaps-lib.js`, `audit-pdf-integrity.js`
- **PTS CDP:** `src/cdpConnectorPage.ts`, `scripts/capture-params.ts`

When splitting work, prefer extracting from bash into existing Node libs rather than new one-off scripts.

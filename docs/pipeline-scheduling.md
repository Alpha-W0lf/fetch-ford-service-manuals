# Pipeline scheduling

How bulk download, param capture, and PTS Chrome (CDP) coordinate.

## Processes

| Process | Command | Browser | Purpose |
|---------|---------|---------|---------|
| Bulk download | `./scripts/bulk-download.sh` | Headless Chromium + CDP for connectors | Workshop, wiring, connector PDFs |
| Param capture | `./scripts/run-capture-params.sh` | PTS Chrome via CDP (`:9222`) | `vehicles/*/params.json` for queue expansion |
| Cookie export | `node scripts/export-cookies-from-chrome.js` | Reads live Chrome | Refresh `templates/cookieString.txt` |

Run bulk and param capture **in parallel**. They share PTS Chrome only briefly.

Health check before start or after a crash:

```bash
./scripts/queue-status.sh --health
./scripts/pipeline-health.sh --fix-locks   # remove stale locks only
```

During long bulk runs (automatic when workers are idle):

- `RECONCILE_EVERY_MIN=60` — periodic `reconcile-queue.js` (default)
- `PDF_AUDIT_EVERY_MIN=120` — random PDF spot-check via `audit-pdf-integrity.js --sample 50`

## Per-vehicle download phases (bulk)

Each `yarn start` job runs sequentially:

1. **Workshop** — headless Playwright + axios PDF fetch
2. **Wiring** — headless page render + SVG/PDF save
3. **Connectors** — CDP tab in live PTS Chrome (`src/cdpConnectorPage.ts`)

`--connectorsOnly` skips workshop/wiring when pages already exist and only retries connectors.

## Queue priority (`scripts/queue-lib.js`)

Lower `queueRank` = picked sooner. Tier 1 anchors get a −10 boost.

| Rank (approx) | Status | Notes |
|---------------|--------|-------|
| −10 | `incomplete` tier 1, fresh gaps | Gap-fill in progress |
| 0 | `incomplete` tier 2+, fresh gaps | |
| 0 | `failed` tier 1 | Retry partial download |
| 10 | `pending` tier 1 | First full download |
| 10 | `failed` tier 2+ | |
| 20 | `pending` tier 2+ | |
| 20+ | `incomplete` stale | Every gap has ≥10 attempts; deprioritized |

Within the same rank: `tier` ascending, then `priority` ascending.

Vehicles with `needs_params` are **not** in the bulk queue until param capture finishes.

## CDP lock (`logs/cdp-chrome.lock`)

Mutual exclusion for PTS Chrome between:

- **Bulk** — only during connector capture (`createConnectorPage` acquire → release on close)
- **Param capture** — per vehicle while navigating PTS (`capture-params.ts`)

Headless workshop/wiring **do not** hold the lock. Bulk connector jobs wait (up to `CDP_LOCK_WAIT_MS`, default 10 min) if param capture holds Chrome.

Stale locks (dead PID) are removed automatically by `scripts/cdp-chrome-lock.js`.

**Do not** manually delete the lock unless you have confirmed no `capture-params` or connector job is running.

## Periodic maintenance (bulk loop)

When no workers are running, `bulk-download.sh` automatically:

| Interval | Env | Action |
|----------|-----|--------|
| 60 min | `RECONCILE_EVERY_MIN` | `reconcile-queue.js` — self-heal failed/interrupted statuses |
| 120 min | `PDF_AUDIT_EVERY_MIN` | `audit-pdf-integrity.js --sample 50` — spot-check corrupt PDFs |

Logs: `logs/reconcile-periodic.log`, `logs/pdf-integrity-spotcheck.log`

Quick status: `./scripts/queue-status.sh --health`

## Verification layers

| Layer | Tool | What it checks |
|-------|------|----------------|
| Completeness | `verify-download-lib.js` | PDF count, cover, wiring TOC, connector manifest, blocking gaps |
| Gap registry | `capture-gaps.json` | Missing pages from runtime + backfill audit |
| PDF integrity | `scripts/audit-pdf-integrity.js` | Magic bytes, minimum size, HTML error pages masquerading as PDF |
| TOC audit | `toc-audit-report.json` | Informational only; does not block queue |

Run after bulk milestones:

```bash
node scripts/backfill-capture-gaps.js
node scripts/reconcile-queue.js
node scripts/audit-pdf-integrity.js --sample 50   # quick fleet sample
node scripts/audit-pdf-integrity.js 2016-transit # one vehicle
```

## Recommended ops rhythm

1. Keep `PARALLEL=2` bulk running (`caffeinate -dims ./scripts/bulk-download.sh`).
2. Run `./scripts/run-capture-params.sh` in another terminal when CDP is up.
3. Refresh cookies every few hours or after auth circuit-breaker trips.
4. After code changes: `node scripts/reconcile-queue.js` before restart (no need to stop for reconcile alone).

## Param capture ordering

`capture-params.ts` sorts `needs_params` vehicles:

1. Tier ascending
2. Model year ≥ 2003 before pre-2003 (legacy PTS UI differs)
3. Year ascending within group

Pre-2003 vehicles are deferred in capture order; fix and validate separately before relying on them.

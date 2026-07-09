# Architecture — Ford PTS bulk pipeline

**Status:** Canonical reference (Dev Guide 01, 2026-07-08)  
**Repo:** `Alpha-W0lf/fetch-ford-service-manuals` (fork) — push **origin only**, never **upstream**

---

## Purpose

Download Ford PTS workshop/wiring/connector PDFs for a prioritized vehicle fleet during a limited subscription window. Two parallel pipelines share one live PTS Chrome instance (CDP `:9222`) for connector PDFs and param capture; headless Playwright handles workshop/wiring bulk fetch.

---

## System diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  macOS Terminal.app (blessed supervisor — PPID=1, caffeinate + nohup)      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 bulk-download.sh         capture-params.ts      PTS Chrome :9222
 (bash orchestrator)       (param capture CLI)    (logged-in session)
        │                       │
        │ PARALLEL × yarn start │ patch-queue → pending
        ▼                       ▼
   src/index.ts            vehicles/*/params.json
   workshop (headless)      templates/vehicles.json
   wiring (headless)
   connectors (CDP) ─────────┘ shared Chrome + cdp-chrome.lock
        │
        ▼
   manuals/<vehicle-id>/
   capture-gaps.json
```

---

## Layer model

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Download core** | `src/` | Single-vehicle job: workshop → wiring → connectors (`yarn start`) |
| **Ops orchestration** | `scripts/bulk-download.sh`, queue libs | Fleet scheduling, parallel workers, cookies, reconcile |
| **Param capture** | `scripts/capture-params.ts` | Automate `params.json` from PTS navigation + network intercept |
| **Verification** | `scripts/verify-download-lib.js`, audits | Disk truth, gaps, PDF integrity |
| **Operator entry** | `docs/PIPELINE_OPS.md`, `BULK_DOWNLOAD_GUIDE.md` | How to start, health-check, troubleshoot |

**Constraint:** Prefer extending existing Node libs over new one-off scripts (`AGENTS.md`).

---

## Runtime modes

| Mode | Browser | Used for |
|------|---------|----------|
| Headless Playwright | Ephemeral Chromium per `yarn start` | Workshop PDF fetch, wiring page render |
| Live Chrome CDP | PTS session on `:9222` | Connector PDFs, param capture, cookie export |
| Bash orchestration | N/A | Bulk polling, worker spawn, periodic maintenance |

Headless workshop/wiring **do not** acquire `cdp-chrome.lock`.

---

## Locks

### Bulk orchestrator lock

- **Path:** `logs/bulk-download.lock/` (mkdir + pid files via `scripts/bulk-lock.js`)
- **Holder:** `bulk-download.sh` orchestrator only
- **Scope:** One bulk orchestrator at a time
- **Stale:** Removed when holder PID is dead

### Queue patch lock

- **Path:** `templates/vehicles.json.patch-lock/` (via `lib/patch-queue.js`)
- **Purpose:** Serialize concurrent status patches from bulk workers and param capture
- **Stale:** Removed when holder PID is dead

### CDP Chrome lock

- **Path:** `logs/cdp-chrome.lock/`
- **Module:** `scripts/cdp-chrome-lock.js`
- **Purpose:** Serialize PTS Chrome navigation between bulk connectors and param capture

| Consumer | Lock scope | Wait behavior |
|----------|------------|---------------|
| **Bulk connectors** | Per connector navigation via `withCdpChromeLock()` in `src/cdpConnectorPage.ts` / `src/wiring/saveConnector.ts` | `CDP_LOCK_WAIT_MS` (default 600000 ms) |
| **Param capture** | Per vehicle during `captureParams()` in `scripts/capture-params.ts` | First pass: `CDP_LOCK_YIELD_MS` (default 120s) then **defer** to retry pass; retry pass: `CDP_LOCK_WAIT_MS` |

**Tab hygiene:** `src/cdpConnectorPage.ts` prunes `about:blank` and `chrome-error://` tabs; during active connector jobs only disposables are closed (never live `/wiring/face` tabs).

**Incident lesson (2026-07-08):** Aggressive tab prune during an active connector job closed a live tab → worker error. Prune rules are now conservative.

---

## Cookie and auth flow

1. Operator logs into PTS in Chrome (`./scripts/launch-pts-chrome.sh`).
2. Headless workers read `templates/cookieString.txt` for workshop/wiring HTTP.
3. Bulk refreshes cookies periodically from live Chrome (`export-cookies-from-chrome.js`, `COOKIE_REFRESH_MIN` default 180).
4. `subscriptionExpired` in browser often means **stale session**, not ended subscription — recover via `src/ptsAuth.ts`, `recover-pts-chrome-session.js`, re-login.

---

## Queue and filesystem state

| Store | Path | Git | Writers |
|-------|------|-----|---------|
| Queue | `templates/vehicles.json` | ignored | `patch-queue.js` (serialized lock + atomic rename), reconcile/backfill (whole-file) |
| Params | `vehicles/<id>/params.json` | ignored | capture-params, manual |
| Artifacts | `manuals/<id>/` | ignored | `yarn start` |
| Gaps | `manuals/<id>/capture-gaps.json` | ignored | `src/captureGaps.ts`, backfill |
| Cookies | `templates/cookieString.txt` | ignored | export-cookies |

See [queue_state_machine.md](./queue_state_machine.md) and [schemas.md](./schemas.md).

**Fleet size:** Base generator **186** + catalog expansion append **109** ≈ **295** vehicles (`generate-vehicle-queue.js` + `append-vehicle-queue.js`).

---

## Gap semantics (summary)

**Queue truth** and **worker exit** both use `lib/capture-gaps-rules.js` (Dev Guide 02): bulk/reconcile/verify via `scripts/capture-gaps-lib.js`; `yarn start` via `src/captureGaps.ts`.

Canonical blocking rules: [schemas.md](./schemas.md#capture-gap-blocking-canonical).

---

## Blessed commands

| Task | Command |
|------|---------|
| Bulk (preferred) | `./scripts/start-bulk-in-terminal.sh` |
| Bulk (already in Terminal) | `SKIP_BACKFILL_ON_START=1 ./scripts/start-bulk-download.sh` |
| Param capture | `./scripts/start-capture-in-terminal.sh` |
| Param capture (in Terminal) | `./scripts/run-capture-params.sh` |
| Health | `./scripts/queue-status.sh --health` |
| Fix stale locks only | `./scripts/pipeline-health.sh --fix-locks` |

**Forbidden:** Start `bulk-download.sh` from Cursor/agent background shells; `flock` on macOS; push to upstream; fleet `backfill-capture-gaps` on every bulk boot (`SKIP_BACKFILL_ON_START=1` default).

**Experimental:** `./scripts/install-bulk-watchdog.sh` — not proven supervision.

---

## Verification layers

| Layer | Tool |
|-------|------|
| Download completeness | `verify-download-lib.js` |
| Gap registry | `capture-gaps.json` + `capture-gaps-lib.js` |
| PDF integrity | `audit-pdf-integrity.js` |
| TOC audit (informational) | `toc-audit-report.json` |

---

## Foundation roadmap (dev guides)

| Guide | Focus |
|-------|-------|
| 01 | This reference (docs) |
| 02 | Test harness + gap/path consolidation | **Executed** |
| 03 | CDP coordination tests | Plan (implementation-ready) |
| 04 | Bulk orchestrator split (bulk stopped) |
| 05 | Capture-params modularization |
| 06 | Pre-2003 capture automation |

Context: [../2026-07-08_codebase_foundation_context_assessment.md](../2026-07-08_codebase_foundation_context_assessment.md)

---

## Related upstream

Single-vehicle upstream flow (`iamtheyammer/fetch-ford-service-manuals`) remains valid: manual `params.json` + `yarn start`. This fork adds fleet ops only; do not push fork changes upstream.

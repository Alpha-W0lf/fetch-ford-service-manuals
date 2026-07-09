# Schemas and contracts

**Canonical blocking rules** for capture gaps are defined here. Dev Guide 02 tests must match this document.

---

## `templates/vehicles.json`

### Root object

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `cookieFile` | string | yes | Usually `templates/cookieString.txt` |
| `parallel` | number | no | Default worker count (typically `2`) |
| `defaults` | object | no | `workshop`, `wiring`, `flags` for all vehicles |
| `vehicles` | array | yes | Fleet entries |

### Vehicle entry

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | e.g. `2018-f-150` |
| `label` | string | yes | Human label |
| `ptsModel` | string | no | PTS menu model name |
| `modelYear` | number | no | Used by capture-params sort |
| `tier` | number | no | 1 = anchor generation; lower = higher priority |
| `priority` | number | no | Sort within tier |
| `phase` | string | no | `breadth` \| `fill` |
| `generation` | string | no | Generation label |
| `paramsFile` | string | yes | e.g. `vehicles/2018-f-150/params.json` |
| `outputDir` | string | yes | e.g. `manuals/2018-f-150` |
| `status` | string | yes | See [queue_state_machine.md](./queue_state_machine.md) |
| `workshop` | boolean | no | Override default |
| `wiring` | boolean | no | Override default |
| `updatedAt` | string | no | ISO timestamp (set by `patch-queue.js`) |

**Example template:** `templates/vehicles.example.json`

---

## `vehicles/<id>/params.json`

Per-vehicle PTS parameters. Shape follows upstream README:

| Section | Purpose |
|---------|---------|
| `workshop` | TreeAndCover POST fields |
| `wiring` | TableofContent query params |
| `pre_2003` | Alphabetical index URL (legacy; capture not automated yet) |

Captured automatically by `scripts/capture-params.ts` for 2003+ vehicles.

---

## `capture-gaps.json`

Per-vehicle under `manuals/<id>/capture-gaps.json`.

### File shape

```json
{
  "version": 1,
  "updatedAt": "ISO-8601",
  "gaps": [ /* CaptureGap[] */ ]
}
```

### CaptureGap fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable gap id |
| `section` | string | yes | `workshop` \| `wiring-page` \| `wiring-connector` \| `wiring-locindex` |
| `name` | string | yes | Display name |
| `relativePath` | string | yes | Path under output dir |
| `expectedFile` | string | yes | Relative file expected |
| `reason` | string | yes | e.g. `auth`, `timeout`, `network` |
| `error` | string | yes | Last error message |
| `attempts` | number | yes | Retry count |
| `lastAttemptAt` | string | yes | ISO timestamp |
| `source` | string | no | `toc-audit`, `connector-audit`, `log-backfill`, runtime |
| `docId`, `cell`, `page` | string | no | Section-specific |

### `toc-audit-report.json`

Informational TOC leaf gaps — **never** queue-blocking. May be migrated out of `capture-gaps.json` via `migrateTocAuditGaps()`.

---

## Capture gap blocking (canonical)

**Source of truth for queue / verify / bulk:** `scripts/capture-gaps-lib.js`

**Must align:** `src/captureGaps.ts` (Dev Guide 02)

### `isBlockingGap(gap)` rules

| Condition | Blocks queue? |
|-----------|:-------------:|
| `source === "toc-audit"` | **No** |
| `source === "log-backfill"` AND no `expectedFile` | **No** |
| All other gaps with expected path or runtime gaps | **Yes** (subject to hybrid-complete) |

### Hybrid complete

When blocking gaps exist but fleet may still mark **complete**:

1. Blocking count ≤ `HYBRID_COMPLETE_MAX_GAPS` (default **5**)
2. Every blocking gap has `source === "connector-audit"`
3. Every such gap has `attempts >= HYBRID_COMPLETE_MIN_ATTEMPTS` (default **3**)

Gaps remain in file for visibility; `hasQueueBlockingGaps()` returns false.

Env: `HYBRID_COMPLETE_MAX_GAPS`, `HYBRID_COMPLETE_MIN_ATTEMPTS` — see [env_vars.md](./env_vars.md).

### Blocking decision matrix (for tests)

| source | expectedFile | blocks (canonical) |
|--------|--------------|:------------------:|
| `toc-audit` | any | no |
| `log-backfill` | missing | no |
| `log-backfill` | present | yes (if file missing) |
| `connector-audit` | present | yes (unless hybrid-complete) |
| runtime / undefined | present | yes (if file missing) |

### Known drift (pre–Dev Guide 02)

~~`src/captureGaps.ts` diverges from canonical JS rules~~ — **aligned in Dev Guide 02** via `lib/capture-gaps-rules.js`.

---

## Lock files

### `logs/bulk-download.lock/`

| File | Content |
|------|---------|
| `pid` | Orchestrator PID |
| `holder` | Label (e.g. `bulk-download`) |

### `logs/cdp-chrome.lock/`

| File | Content |
|------|---------|
| `pid` | Holder process PID |
| `holder` | e.g. `capture-params`, `connector-<pid>` |

---

## Test fixtures (Dev Guide 02)

Use copies under `test/fixtures/` — never mutate operator `templates/vehicles.json` or `manuals/` in tests.

Minimum fixtures to define (shapes only in Guide 01; files in Guide 02):

- `test/fixtures/minimal-queue.json` — 2–3 vehicles, mixed statuses
- `test/fixtures/minimal-capture-gaps.json` — rows covering blocking matrix
- `test/fixtures/minimal-manual-tree/` — created in tests (cover.html, sample PDFs for verify-download)

Pattern source: `templates/vehicles.example.json`

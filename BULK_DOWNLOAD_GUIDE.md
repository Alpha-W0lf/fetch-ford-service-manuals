# Bulk Ford manual download guide (72-hour PTS subscription)

## Reality check

**You cannot download "all Ford vehicles" in 2.5 days.** PTS has thousands of year/model combinations. This tool downloads **one manual per `params.json`**, and each full download takes roughly:

| Mode | Time (typical) | Size (typical) |
|------|----------------|----------------|
| Workshop + wiring (full) | 1–2 hours | 500 MB – 1.5 GB |
| Workshop only | 30–60 min | 300–800 MB |
| Wiring only | 20–60 min | 200–500 MB |

**Realistic capacity in ~60 hours of wall time:** ~15–30 full manuals if the laptop runs continuously, or **40–60 workshop-only** if you skip wiring.

**Best strategy:** download **platform representatives** and vehicles you actually care about — not every year/trim.

---

## What the tool does NOT automate

Per vehicle you must **once** (in PTS + DevTools):

1. Select year/model or VIN → **GO**
2. **Workshop tab** → capture `TreeAndCover/workshop` POST form fields → `params.json` `workshop` section
3. **Wiring tab** → capture `TableofContent` GET query params → `params.json` `wiring` section
4. Set `category` / `CategoryDescription` if needed (Transit = `32` / `ODYXML`; many cars default `33` / `GSIXML`)

Cookies are **shared** across vehicles for your subscription session. Refresh every ~12–24 hours from:

```
https://www.fordtechservice.dealerconnection.com/
```

Copy the full `cookie:` header from that **document** request, append `CONTENT_AUTH` + `CONTENT_PERMISSIONS` from any `fordservicecontent.com` request, save to `templates/cookieString.txt`.

---

## Parallel downloads

The bulk script supports **2 parallel workers** by default (`parallel: 2` in `vehicles.json`).

### How to start bulk (important)

**Always use macOS Terminal.app** — not Cursor's integrated terminal — for runs longer than a few minutes.

```bash
cd /Users/tom/Documents/Git/fetch-ford-service-manuals
./scripts/start-bulk-in-terminal.sh
```

This opens Terminal, fixes stale locks, reconciles the queue, and starts bulk under `caffeinate` + `nohup`.

**If you are already in Terminal.app:**

```bash
SKIP_BACKFILL_ON_START=1 ./scripts/start-bulk-download.sh
```

**Health check (any time):**

```bash
./scripts/queue-status.sh --health
```

See also: `docs/pipeline-scheduling.md`, `docs/2026-07-08_pipeline_inventory_and_action_items.md`.

**Do not** run `./scripts/bulk-download.sh` directly from Cursor agent sessions — the orchestrator dies when the session ends.

**Honest limits:**
- Each `yarn start` launches its own Chromium + PDF renderer (~500MB RAM each).
- **2 workers is the sweet spot.** 3 may work; 4+ risks Ford throttling, cookie/session weirdness, and disk contention.
- Parallel speeds up **downloads only**. Params capture is still sequential unless we automate it separately.

## Long prioritized queue

```bash
node scripts/generate-vehicle-queue.js   # rebuild from generation definitions
./scripts/queue-status.sh                # what's done / next
```

Queue file: `templates/vehicles.json` — currently **186 vehicles**:
- **Tier 1** (breadth): one anchor year per generation — trucks/commercial first
- **Tier 2+** (fill): remaining years in each generation
- **Tier 3**: consumer cars/SUVs

Statuses: `needs_params` → `pending` → `complete` | `incomplete` | `failed`

**Critical:** bulk idles when no vehicles have `status: pending` and a `params.json` file. Run param capture in a **second Terminal** while bulk runs:

```bash
./scripts/start-capture-in-terminal.sh
```

Or if already in Terminal: `./scripts/run-capture-params.sh`

Param capture waits for the CDP lock when bulk is on connector pages.

## Time math (~60 hours left)

At ~45–60 min/vehicle (Transit was ~1 hr):
- Sequential: ~45–60 vehicles max
- 2 parallel: ~70–90 vehicles max
- Full queue (186): needs ~140+ hours sequential — **won't finish everything**

**Plan:** finish all **27 tier-1 anchors** first (~14–20 hrs with 2 workers), then tier-2 truck years, then consumer fill-ins until time runs out.

### Phase 1 — Tonight: build your queue (30–60 min manual)

1. Copy the example queue:
   ```bash
   cp templates/vehicles.example.json templates/vehicles.json
   ```
2. For each vehicle you want, create a folder:
   ```bash
   mkdir -p vehicles/2018-f150
   cp templates/params.json.template vehicles/2018-f150/params.json
   ```
3. Fill `params.json` from DevTools (see README sections *2003 or newer* and *Get wiring data*).
4. Add an entry to `templates/vehicles.json` with `"status": "pending"`.
5. Mark Transit as `"status": "complete"` (already done).

### Phase 2 — Run overnight (automated)

Use `./scripts/start-bulk-in-terminal.sh` (see **How to start bulk** above). Logs:

- Orchestrator: `logs/bulk-download-*.log`
- Per vehicle: `logs/<vehicle-id>.log`

### Phase 3 — Verify each morning

```bash
./scripts/verify-download.sh manuals/2018-f150
```

---

## Speed vs completeness tradeoffs

| Goal | Flags | Notes |
|------|-------|-------|
| **Maximum vehicles** | `--noWiring` in queue or per-vehicle `"wiring": false` | Workshop only; ~2× throughput |
| **Electrical coverage** | Full download | Needs good dealerconnection cookies for connector PDFs |
| **Retry failed wiring** | `--noWorkshop` | What we used for Transit connector fix |

In `vehicles.json`, per vehicle:

```json
{
  "id": "2015-mustang",
  "workshop": true,
  "wiring": false,
  "status": "pending"
}
```

---

## Suggested priority list (edit for your needs)

Platform manuals cover many variants — one download per **platform year** is often enough:

- ✅ 2016 Transit (done)
- F-150 (pick your model years — huge manuals)
- Super Duty F-250/F-350
- Mustang
- Explorer
- Escape
- Focus / Fiesta (if pre-2023)
- Ranger

Use **By Year & Model** in PTS when you don't have a VIN. Same platform + year = same manual for all trims/engines (filter sections when reading).

---

## params.json capture cheat sheet

### Workshop (TreeAndCover POST)

Filter Network: `TreeAndCover/workshop`

Copy from **form data / payload**:

- `vehicleId`, `modelYear`, `book`, `bookTitle`
- `WiringBookCode`, `WiringBookTitle`
- `category`, `CategoryDescription` (if present)
- `channel`, `booktype`, `country`, `contentmarket`, `contentlanguage`, `languageOdysseyCode`

### Wiring (TableofContent GET)

Filter Network: `TableofContent` on **fordservicecontent.com** (singular Content)

Copy query params into `wiring`:

- `environment` (changes over time — always re-copy)
- `bookType`, `languageCode`

---

## Troubleshooting bulk runs

| Symptom | Fix |
|---------|-----|
| `Failed to log in` / connector failures | Refresh `cookieString.txt` from dealerconnection.com `/` |
| `ERR_HTTP2_PROTOCOL_ERROR` | Use `--noCookieTest`; ensure cookies fresh |
| Wrong/missing workshop sections | Check `category` / `CategoryDescription` in params |
| `subscriptionExpired` in browser / cookie test | Usually **stale PTS session**, not ended subscription. Re-login: `node scripts/open-pts-login-tabs.js` → open PTS from My Subscriptions → `node scripts/export-cookies-from-chrome.js` |
| Run stopped when lid closed | Use `./scripts/start-bulk-in-terminal.sh` (`caffeinate` included); verify with `./scripts/queue-status.sh --health` |
| Orchestrator died after ~2 min | Started from Cursor — use Terminal.app instead |
| Stale bulk lock | `./scripts/pipeline-health.sh --fix-locks` then restart via Terminal |
| Disk full | ~1 GB per full manual; plan 30–50 GB for a large batch |

---

## Files in this repo

| File | Purpose |
|------|---------|
| `templates/vehicles.json` | Your download queue (create from example) |
| `templates/cookieString.txt` | Shared auth cookies |
| `vehicles/<id>/params.json` | Per-vehicle PTS parameters |
| `manuals/<id>/` | Download output |
| `logs/<id>.log` | Per-vehicle run log |
| `scripts/bulk-download.sh` | Queue orchestrator (do not start directly from Cursor) |
| `scripts/start-bulk-in-terminal.sh` | **Preferred** — start bulk in Terminal.app |
| `scripts/start-bulk-download.sh` | Detached start when already in Terminal |
| `scripts/run-capture-params.sh` | Capture `params.json` for queue expansion |
| `scripts/queue-status.sh --health` | Pipeline health |
| `scripts/verify-download.sh` | Quick PDF count check |

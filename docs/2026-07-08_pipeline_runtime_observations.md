# Pipeline runtime observations — 2026-07-08 evening session

**Checkpoint time:** ~22:24 local (session ~70 min)  
**Prior checkpoint:** ~22:07 — see changelog below  
**Related:** [2026-07-08_pipeline_inventory_and_action_items.md](./2026-07-08_pipeline_inventory_and_action_items.md), [pipeline-scheduling.md](./pipeline-scheduling.md), [reference/architecture.md](./reference/architecture.md)

---

## Executive summary

| Pipeline | Running? | Progressing? | Verdict |
|----------|----------|--------------|---------|
| **Bulk** | Yes (pid 28011, ~70 min) | Yes — connectors saving; ~1962+ / ~2167 PDFs | **Healthy, slow** |
| **Param capture** | Yes (pid 29405) | Partial — **7 OK**, **23 defer**, **3 FAIL**; PTS home timeouts under load | **Stressed** — watch consecutive fails |

**You are not mistaken** about low visible Chrome activity — that is **expected** for most bulk work. See [Why Chrome looks idle](#why-chrome-looks-idle) below.

---

## Work completed this session (since ~21:14)

### Bulk download

| Metric | Session start (~21:14) | Now (~22:07) | Delta |
|--------|------------------------|--------------|-------|
| `complete` | 57 | **59** | **+2** (`2004-f-150`, `2018-f-550`) |
| Tier 1 anchors | 33/38 | **35/38** | +2 |
| `pending` | 182 | 167 | −15 (failed + in-flight + capture→pending) |
| `needs_params` | 54 | **47** | −7 (capture OK) |
| `failed` | ~0–1 | **19** | auth burst ~02:29 UTC (stable since) |

**In flight (downloading):**

| Vehicle | Uptime | Log lines | PDFs on disk | Phase (from logs) |
|---------|--------|-----------|--------------|-------------------|
| `2016-f-250` | ~37 min | 2,507 | **1,935** | Connectors — CDP lock holder `connector-51173`; **16** `page.goto` timeout/connector load failures (retrying) |
| `2018-expedition-max` | ~37 min | 1,866 | **1,851** | Connectors — actively saving (`Saving connector …`) |

No new `complete` since `2018-f-550` (~02:28 UTC) because both parallel slots are on **large, connector-heavy** jobs — not because the orchestrator is stuck.

### Param capture

| Metric | Value |
|--------|-------|
| Targets (first pass) | 51 modern `needs_params` |
| **OK** | **7** (`2009-flex`, `2009-navigator`, `2010-navigator`, `2010-fusion`, `2011-navigator`, `2011-edge`, `2011-fiesta`) |
| **FAIL** | 2 (`2003-f-250` workshop intercept; one other early fail) |
| **Deferred** (first pass) | **21+** — `CDP busy (connector-51173)` |
| Current | First pass advancing through queue (`2009-focus` at last log write) |

Capture is **not idle** — it is **fast-deferring** vehicles while bulk connector job holds `cdp-chrome.lock`. Deferred vehicles run in the **retry pass** after first pass completes (`capture-params.ts` two-pass flow).

---

## Why Chrome looks idle

This is **by architecture**, not a sign that nothing is running.

### Broken tabs ("connection reset" / ERR_TIMED_OUT) — common under load

You may see **one or more PTS Chrome tabs** showing:

- *The connection was reset*
- *This site can't be reached … ERR_TIMED_OUT*

**This does not necessarily mean the pipelines are dead.** Typical causes:

| Cause | What happens |
|-------|----------------|
| **Connector `page.goto` timeout** | Bulk opens wiring/face URLs in PTS Chrome (CDP). Slow PTS or Akamai → navigation fails; tab may show error until closed or overwritten. |
| **Capture PTS home reset** | After a vehicle, capture runs `page.goto` to PTS home. If bulk connector still holds CDP lock and PTS is busy, home load can **timeout** (90s) — tab shows error. |
| **Background connector tabs** | `CDP_BACKGROUND_TAB=1` (default) — failed loads may sit in background until prune. |
| **Stale tabs** | Not every failed navigation is closed immediately; Chrome can accumulate error pages. |

**At ~22:24 checkpoint:** CDP listed PTS **home** + active **Connector Viewer** tab; bulk worker `2016-f-250` still saving connectors (2500+ log lines). Error tabs are **symptoms of PTS/network stress**, not proof orchestrator failure.

**When to act:**

- **Bulk vehicle logs still growing** (e.g. `Saving connector …`) → keep running; optional `npx ts-node scripts/prune-cdp-tabs.ts` only when **no** connector job active (or after worker completes).
- **Capture hits 5 consecutive fails** or all `page.goto` to PTS home fail → refresh PTS Chrome: `./scripts/launch-pts-chrome.sh`, re-login, `./scripts/start-capture-in-terminal.sh --restart` (bulk can keep running).
- **Both workers stuck** with only timeout lines for 10+ min → re-login PTS + cookie export.

### Phase visibility (no window vs background tab)

| Phase | Browser | Visible? |
|-------|---------|----------|
| Workshop PDFs | Headless Playwright (`HEADLESS_BROWSER` default on) | **No window** |
| Wiring pages | Headless Playwright | **No window** |
| Connectors | PTS Chrome via CDP (`:9222`) | Often **background tab** (`CDP_BACKGROUND_TAB=1` default) |
| Param capture | PTS Chrome | Navigates when lock free; **defers** when bulk holds lock |

**Symptoms that are still healthy:** Activity Monitor shows `node`/`yarn` workers; `logs/<vehicle>.log` growing; capture log shows `OK:` or `deferring to retry pass`.

**Debug only:** `CDP_BACKGROUND_TAB=0` — not for parallel production runs.

See [pipeline-scheduling.md](./pipeline-scheduling.md) § Why Chrome may look idle.

---

## What is going wrong (diligent notes)

### A. Auth failure burst (bulk) — **watch, not panic**

- **When:** ~02:29 UTC (~21:29 local)
- **What:** ~19 vehicles → `failed` in rapid succession (F-250, Transit, Ranger, Maverick, Expedition, etc.)
- **Logs:** `HTTP 403 Forbidden`, `Ford CDN returned Access Denied`
- **Likely cause:** Cookie/session contention when bulk headless + capture + cookie refresh overlapped
- **Mitigation in code:** Orchestrator records auth failure, refreshes cookies from PTS Chrome after each fail
- **Status at 22:07:** Count **stable at 19**; long jobs recovered; failed vehicles **will retry** via `queue-lib` rank
- **Operator action if count climbs again:** Re-login PTS Chrome (`./scripts/launch-pts-chrome.sh`), keep bulk running

### B. Long connector job blocks capture first pass — **expected, costly**

- **What:** `2016-f-250` connector phase held CDP lock ~37+ minutes
- **Effect:** Capture deferred 21+ vehicles in first pass; E-Transit tier-1 still waiting for retry pass
- **Class:** CDP coordination working as designed (Guide 03); **throughput tradeoff** under `PARALLEL=2` with connector-heavy trucks
- **Not a bug** unless capture retry pass yields zero OK after bulk releases CDP

### C. `2016-f-250` connector timeouts — **active issue, worker retrying**

- **Evidence:** 16× `Connector load failed` / `page.goto: Timeout 45000ms exceeded` on wiring/face URLs
- **Effect:** Slows connector completion; does not stop worker (retries + cookie refresh in log)
- **Risk:** Job may end `incomplete` with capture gaps if timeouts persist
- **Monitor:** `tail -f logs/2016-f-250.log`

### D. `2003-f-250` capture fail — **low priority**

- Workshop tab did not trigger `TreeAndCover/workshop` intercept — edge year; Guide 06 scope

### F. Chrome error tabs + capture PTS home timeout — **new ~22:24**

- **User report:** Two PTS tabs — "connection reset" and `ERR_TIMED_OUT` on fordtechservice.dealerconnection.com
- **Explanation:** Failed `page.goto` from connector retries and/or capture `resetPtsSession` while PTS under load; see § Broken tabs above
- **Evidence:** `FAIL 2009-crown-victoria: page.goto: Timeout 90000ms`; `2016-f-250` **22** connector goto timeouts; bulk still appending `Saving connector …`
- **Action:** Monitor capture for 5 consecutive fails; refresh PTS Chrome if capture stops progressing; do **not** kill bulk if `2016-f-250`/`2018-expedition-max` logs still grow

---

## Process / lock snapshot (~22:07)

```
bulk-orchestrator.js     pid 28011   bulk-download.lock held
caffeinate + bulk.sh     pid 28013
capture-params --all     pid 29405   (first pass)
yarn start × 2           2016-f-250 (51173), 2018-expedition-max (51762)
cdp-chrome.lock          holder: connector-51173
CDP :9222                up, 7 targets
```

---

## Logging gaps & recommended improvements (P2 — do not block current run)

Current observability is **log-file-centric**; the orchestrator log shows START/FAIL lines but not live phase detail.

| Gap | Recommendation | Blast radius |
|-----|----------------|--------------|
| No periodic heartbeat in orchestrator log | Every 5 min: `inFlight`, vehicle id, worker pid, queue counts | Low — Guide 04.1 or Phase G |
| Connector phase invisible in orchestrator log | Tee one line per phase change to `logs/bulk-download-*.log` from worker (or poll vehicle log mtime) | Low |
| Hard to see why Chrome is idle | **Done:** this doc + `pipeline-scheduling.md` visibility section | Docs only |
| Capture first-pass vs retry pass | Log summary: `First pass: N ok, M defer, K fail` before retry | Low — Guide 05 `cli.ts` |
| Auth burst post-mortem | Log `recent-403-stamps.txt` count when circuit breaker trips | Low — `bulk-orchestrator-lib.js` |

**Do not add verbose logging mid-subscription** without a dev guide — risk of log volume / behavior change. Document first; implement in Guide 05 or Phase G.

---

## Operator commands

```bash
./scripts/queue-status.sh --health
tail -f logs/bulk-download-*.log
tail -f logs/capture-params-*.log
tail -f logs/2016-f-250.log logs/2018-expedition-max.log
grep -c '^OK:' logs/capture-params-*.log
node scripts/cdp-chrome-lock.js info 2>/dev/null || cat logs/cdp-chrome.lock/pid
```

---

## Next focus

1. **Let current workers finish** — especially `2016-f-250` / `2018-expedition-max`
2. **Watch capture retry pass** for E-Transit OK lines after first pass ends
3. **Monitor `failed` count** — stable = OK; climbing = PTS re-login
4. **Defer Guide 05** until capture session ends or deliberate stop
5. **Optional:** `CDP_BACKGROUND_TAB=0` only for debugging connector visibility (single vehicle)

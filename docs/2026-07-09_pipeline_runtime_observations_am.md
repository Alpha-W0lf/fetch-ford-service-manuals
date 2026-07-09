# Pipeline runtime observations — 2026-07-09 (morning)

**Period covered:** ~01:36 local (bulk restart on Guide 04.2) through ~11:40 local  
**Bulk log:** `logs/bulk-download-20260709-0136.log`  
**Orchestrator pid:** 75301 (continuous since restart)  
**Related:** [2026-07-09_pipeline_session_checkpoint.md](./2026-07-09_pipeline_session_checkpoint.md), [known_issues_and_backlog.md](./known_issues_and_backlog.md)

---

## Executive summary (12:06 local)

| Pipeline | Status | Notes |
|----------|--------|-------|
| **Bulk orchestrator** | **Healthy** | pid **75301** since 01:36; ~10.5h uptime; 6,600+ heartbeats; 0 hung/stale reaps |
| **Worker `2020-explorer`** | **Active** | Long workshop run (~50 min on current pid) |
| **Worker `2016-police-interceptor-utility`** | **Active** | Dispatched after `2024-bronco` OK |
| **Param capture** | **Not running** | Last session ~01:36–02:00; REL-02 clean exit verified |

**Queue:** `complete: 88` (+24 since restart) · `downloading: 2` · `incomplete: 1` (`2005-f-150`) · `needs_params: 7` · `pending: 196`

**21 verified OK** this bulk session — includes **`2024-bronco`** (completed after REL-08 storm recovery).

---

## Timeline

### 01:36 — Restart (Guide 04.2 smoke)

- Bulk: `./scripts/start-bulk-in-terminal.sh` → log `bulk-download-20260709-0136.log`
- Capture: `./scripts/start-capture-in-terminal.sh --limit 3`
- Orphan prune at startup: 4 stale `prune-cdp-tabs` PIDs killed (`[reap-prune]`)
- Heartbeats every ~5s from first tick

### 01:36–02:00 — Capture session

| Vehicle | Result |
|---------|--------|
| `2003-f-250` | FAIL — workshop intercept (borderline year) |
| `2022/2023/2024-e-transit` | FAIL — model not in PTS menu (RUN-06) |
| `2010-taurus` | OK |
| `2009-crown-victoria` | OK (after CDP deferral on first pass) |
| `2012-escape` | OK |
| Retry pass | 3 captured, 2 failed, 0 deferred |

REL-02 verified: `PTS Chrome left open for bulk (Playwright CDP disconnected)`; capture process exited.

### 01:36–02:50 — Early bulk progress

| Event | Detail |
|-------|--------|
| `2021-f-250` | OK (connectors-only retry) |
| `2022-f-250` | Long connector run; tail CDP lock timeout on Vehicle Repair Location Charts |
| `2018-transit` | 10 min CDP wait → headless connector fallback → OK after retry |
| Queue | `complete` 64 → 65; `needs_params` 10 → 7 |

### 02:50–10:00 — Overnight unsupervised soak (~7h)

**04.2 acceptance:** Session passed **4h merge gate** and **12h REL close-out** bar (~10h orchestrator uptime).

| Metric | Start (01:36) | ~10:00 | Delta |
|--------|---------------|--------|-------|
| `complete` | 64 | 83 | +19 |
| Verified OK (log) | 0 | 16 | +16 |
| Heartbeats | 0 | ~5,700 | — |
| `[reap-hung]` / `[reap-stale]` | 0 | 0 | — |

**Completions overnight:** Full Transit line (2018/2019/2021/2022), Rangers (2020–2024), Mavericks (2023/2024), Mustangs (2022/2023), Broncos (2022/2023), Bronco Sport (2022), Explorers (2011/2016), `2007-expedition`.

**Overnight auth burst (~02:30–08:00):** Large batch of tier 2/3/4 vehicles failed with `HTTP 403 Forbidden` / `Ford CDN returned Access Denied`. Queue briefly showed `failed: 127`; later reconciled as vehicles retried and some succeeded. Cookie refresh + circuit breaker fired on several Mustangs/Expeditions; auth recovered for newer vehicles.

**CDP contention:** Multiple workers hit `Timed out waiting for PTS Chrome CDP lock (600000ms)`; headless fallback used where supported.

### 09:30–11:30 — `2024-bronco` fast-fail storm + recovery

**Symptom:** One parallel slot cycled `START → INCOMPLETE` on `2024-bronco` every ~5–15 seconds (~**691** cycles logged). Heartbeat showed `2024-bronco=pid:pending` between respawns — **not idle**, but **wasting a slot**.

**Log error (11:26):**

```
PTS session warmup failed — auth redirect:
.../subscriptionExpired?expiredOn=7/9/2026 11:26:40 AM&country=USA
```

**Operator clarification (11:40):** Subscription likely **still active**; manual PTS login shows vehicle selection page. This aligns with architecture doc: `subscriptionExpired` URL often indicates **stale PTS Chrome session**, not Motorcraft subscription end (`docs/reference/architecture.md`, `src/ptsAuth.ts`).

**Recovery (~11:33+):** After cookie/session recovery, `2024-bronco` progressed through connectors (`C1446`, `C1449`, …). `capture-gaps.json` cleared to `gaps: []`. `2023-bronco` OK earlier in session.

**Concurrent worker:** `2020-explorer` remained healthy throughout — workshop downloads never stalled.

---

## Verified completions this session

21 vehicles with `OK: … (verified, no gaps)` in `bulk-download-20260709-0136.log`:

`2021-f-250`, `2018-transit`, `2019-transit`, `2021-transit`, `2022-transit`, `2020-ranger`, `2021-ranger`, `2022-ranger`, `2023-ranger`, `2024-ranger`, `2023-maverick`, `2024-maverick`, `2007-expedition`, `2022-mustang`, `2023-mustang`, `2022-bronco`, `2023-bronco`, `2022-bronco-sport`, `2011-explorer`, `2016-explorer`, **`2024-bronco`** (post–REL-08 recovery)

---

## Network bandwidth (11:26 sample)

| Sample | Download | Upload |
|--------|----------|--------|
| Whole machine `en0`, 10s | ~4.4 Mbps | ~0.6 Mbps |
| Single worker (quiet window) | ~0.08 Mbps | ~0.14 Mbps |

Traffic is **bursty** (PDF fetches + idle between pages). On 100+ Mbps broadband: typically **2–10%** during peaks. On 25 Mbps or less: brief noticeable contention possible.

---

## Engineering observations & enhancement candidates

### REL-08 — INCOMPLETE fast-retry storm (P1)

**What happened:** `incomplete` vehicles have **highest queue priority** (`queueRank` 0 in `scripts/queue-lib.js`). When a job fails in seconds (auth redirect), orchestrator immediately re-dispatches the same vehicle, consuming a parallel slot without productive work.

**Why circuit breaker did not help:**

1. `runOne` returns on `INCOMPLETE` **before** `authFailureIsRecent` + `recordAuthFailure` (lines 565–570 vs 582–584 in `bulk-orchestrator-lib.js`).
2. `spawnYarnStart` **truncates** vehicle log each run (`createWriteStream` default `'w'`), so even if we recorded auth on INCOMPLETE, cross-run log evidence is lost.

**Why stale-gap deprioritization did not help:**

- `STALE_GAP_ATTEMPTS` (default 10) should deprioritize when all blocking gaps have ≥10 attempts.
- During the storm, `capture-gaps.json` showed `attempts: 1` despite hundreds of retries — **needs investigation** (gap id churn, gap cleared on partial success, or record path not hit on warmup failure).

**Impact:** Wastes 50% parallelism during auth blips; burns CPU/log churn; does **not** improve recovery speed.

### REL-09 — `subscriptionExpired` operator confusion (P2)

PTS redirects to `subscriptionExpired?expiredOn=…` when **browser session is stale**, not necessarily when Motorcraft subscription ended. Code already documents this (`ptsAuth.ts`, `architecture.md`, `BULK_DOWNLOAD_GUIDE.md`) but monitoring agents may misreport "subscription expired."

**Mitigation today:** `recoverPtsPageSession()`, cookie refresh every 180 min, manual re-login via `open-pts-login-tabs.js`.

### PIPE-08 — CDP lock 10 min wait under PARALLEL=2 (P2)

When two workers need connectors, second worker often waits `CDP_LOCK_WAIT_MS` (600s) then headless fallback. Not a hang; reduces effective parallelism and extends job time.

### PIPE-09 — `2022-f-250` tail incomplete (P3)

Marked `complete` in queue despite CDP timeout on Vehicle Repair Location Charts. Low priority targeted retry.

### OPS-08 — Queue `failed` count volatility (P2)

Overnight `failed: 127` reconciled down as retries succeeded. Operator health output can look alarming during auth bursts even when pipeline is recovering.

---

## Honest assessment: should we change behavior?

### What is working (do not weaken)

| Mechanism | Why keep it |
|-----------|-------------|
| `reapHungWorkers` (20 min log stale) | 2016 TCM episode recovered without kill — aggressive threshold would false-positive |
| `WORKER_MAX_RUNTIME_MS` (4h) | Bounds runaway jobs without killing normal Transit/F-250 runs |
| INCOMPLETE auto-retry | `2018-transit`, `2016-f-250`, `2007-expedition` recovered via retry |
| Disk-truth `patchStaleWorkerFromDisk` | Prevents wrong queue status on forced reap |
| Heartbeats | Enabled all session monitoring; stall vs slow distinguishable |

### Recommended enhancements (Guide 04.3 candidate — after bulk stops)

**Tier A — High value, low regression risk**

1. **Auth-aware INCOMPLETE handling**  
   After `INCOMPLETE`, if `authFailureIsRecent(logPath)` OR gap `reason` is `subscription-expired`/`auth`: call `recordAuthFailure` and treat like FAIL for circuit-breaker purposes.

2. **Per-vehicle retry cooldown**  
   Track `lastFailAt` + `consecutiveFastFails` in orchestrator state (or a small sidecar file). If job runtime < 60s and fails ≥3 times in 15 min, **exclude vehicle from `nextJob` for N minutes** (e.g. 15–30) and dispatch next pending vehicle instead.

3. **Fix gap attempt accounting on auth warmup failure**  
   Ensure `captureGaps.record()` increments attempts on repeated `subscription-expired` connector warmup failures so `STALE_GAP_ATTEMPTS` deprioritization actually triggers.

4. **Orchestrator log line for fast-fail cooldown**  
   `[cooldown] 2024-bronco excluded 15m (3 fast auth fails)` — operator visibility without reading vehicle logs.

**Tier B — Medium value**

5. **Pre-dispatch session probe**  
   Before `START` on connectors-only retry, optional lightweight cookie/session check; skip dispatch if PTS Chrome is on auth redirect (trigger cookie refresh once, then cooldown).

6. **Append vehicle logs instead of truncate**  
   Or keep last-run auth snippet for circuit breaker. Truncation hides failure patterns across retries.

**Tier C — Defer**

7. **Reduce INCOMPLETE priority below pending** — risks leaving real gaps unaddressed; prefer cooldown over deprioritization.
8. **Lower hung-reap threshold** — risks killing slow-but-valid connector jobs.

### Will it self-heal today?

| Scenario | Self-heal? |
|----------|------------|
| Stale PTS session (`subscriptionExpired` URL) | **Often yes** — cookie refresh, manual login, `recoverPtsPageSession` (as seen with `2024-bronco` ~11:33) |
| Actual Motorcraft subscription end | **No** — requires renewal; workers will fast-fail until operator intervenes |
| Hung-alive worker (log frozen) | **Yes** — `reapHungWorkers` at 20 min (04.2) |
| Dead worker PID | **Yes** — `reapStaleWorkers` + disk patch (04.1) |
| INCOMPLETE retry storm | **Partial** — eventually session may recover, but slot wasted until then; **691 cycles** is not acceptable steady-state |

---

## `tsconfig.json` review (2026-07-09)

### IDE error: "Cannot write file" (TS5055) — **fixed**

**Symptom:** Cursor/VS Code showed 16 errors on `tsconfig.json` line 1:
`Cannot write file '.../lib/bulk-auth-log.js' because it would overwrite input file.`

**Root cause:** Project is **typecheck-only** (runtime uses `ts-node` for `src/` and hand-written `.js` in `lib/` + `scripts/`). Config had:

- `allowJs: true`
- `include: ["src/**/*", "lib/**/*", "test/**/*"]` — includes hand-written `lib/*.js`
- **No `noEmit: true`** in file (only `yarn typecheck` → `tsc --noEmit` on CLI)

IDE **tsserver** loads `tsconfig.json` without `--noEmit`, attempts emit, and TS5055 fires because output `.js` would overwrite input `.js`. Tests also import `../scripts/*.js`, pulling those into the graph.

**Fix (2026-07-09):** Added `"noEmit": true` to `compilerOptions`. Aligns IDE with CLI; no runtime change (nothing ever relied on `tsc` emit).

**Verify:** `yarn typecheck` passes; IDE lints on `tsconfig.json` clear.

### Remaining tsconfig scope (CODE-07)

| Item | Assessment |
|------|------------|
| `include` excludes `scripts/*.ts` | **Intentional debt** — `capture-params.ts` typechecked only via `ts-node` at runtime |
| `strict: true`, `skipLibCheck: true` | Appropriate |
| Phase G | Extend `include` to `scripts/**/*`; fix surfaced errors incrementally |

---

## Operator actions (when subscription actually ends)

1. Expect widespread `403` / `subscriptionExpired` / fast-fail storms.
2. Stop bulk gracefully (Terminal Ctrl+C) or let circuit breaker pause new jobs.
3. Renew subscription; re-login PTS; `node scripts/export-cookies-from-chrome.js`.
4. Restart bulk; reconcile queue if needed: `node scripts/reconcile-queue.js`.
5. Optionally start capture for remaining 7 `needs_params` before subscription lapses.

---

## Second-pass session audit (full chat context)

This section captures **all** issues, observations, and decisions from the 2026-07-09 monitoring session (01:36–11:50 local) so nothing is lost between chat turns.

### Guide 04.2 deployment context (pre-restart)

| Item | Detail |
|------|--------|
| **Prior fix** | Guide 04.1 (`6c15180`) — RUN-01 orchestrator freeze from blocking `spawnSync(prune-cdp-tabs)` |
| **04.2 shipped** | `reapHungWorkers`, heartbeat, orphan prune reaper, capture CDP disconnect (REL-02), watchdog stall detect |
| **Env defaults** | `WORKER_LOG_STALE_MS=20m`, `WORKER_MAX_RUNTIME_MS=4h`, `WORKER_KILL_GRACE_MS=5s`, `PRUNE_ORPHAN_MAX_AGE_MIN=30` |
| **Tests** | 85 tests green at ship time |
| **Restart** | ~01:36 via `start-bulk-in-terminal.sh` + `start-capture-in-terminal.sh --limit 3` |

### Reliability mechanisms verified this session

| ID | Mechanism | Session evidence |
|----|-----------|------------------|
| REL-01 | Hung-alive reap (20 min log stale) | 0 triggers; 2016 TCM archetype not re-killed |
| REL-02 | Capture clean CDP exit | Verified ~02:00 — process exited after session |
| REL-03 | Orphan prune reaper | 4 stale PIDs killed at 01:36 startup |
| REL-05 | Heartbeat | 6,600+ lines; enabled all operator monitoring |
| REL-06 | Max runtime 4h | 0 triggers; `2020-explorer` ran 23+ min without issue |
| REL-04 | Watchdog stall detect | Not exercised (orchestrator never froze) |
| **REL-08** | INCOMPLETE fast-retry storm | **New gap** — `2024-bronco` ~691 cycles; see above |

### Capture session detail (01:36–02:00)

| Vehicle | Outcome | Notes |
|---------|---------|-------|
| `2003-f-250` | FAIL | Workshop intercept — borderline year (PIPE-05) |
| `2022/2023/2024-e-transit` | FAIL | Model not in PTS menu (RUN-06) |
| `2010-taurus` | OK | |
| `2009-crown-victoria` | OK | First pass **deferred** (CDP busy) — looked like hang, was deferral |
| `2012-escape` | OK | Retry pass after deferral |
| **Remaining `needs_params` (7)** | — | `2000/2001/2002-excursion`, `2003-f-250`, `2022/2023/2024-e-transit` |

### Bulk job incidents (chronological)

| Vehicle | Incident | Resolution |
|---------|----------|------------|
| `2021-f-250` | Connectors-only retry | OK verified |
| `2022-f-250` | ~40 min run; CDP timeout on Vehicle Repair Location Charts at tail | Queue `complete`; possible missing repair charts (PIPE-09) |
| `2018-transit` | 10 min CDP lock wait → headless connector fallback | INCOMPLETE → retry → OK |
| `2019/2021/2022-transit` | — | All OK overnight |
| `2020–2024-ranger`, `2023/2024-maverick` | — | All OK |
| `2007-expedition` | Multiple FAIL then OK | Circuit breaker + cookie refresh |
| Mustangs 2012–2021 | Overnight 403 burst | FAIL |
| `2022/2023-mustang` | — | OK after auth recovery |
| `2022/2023-bronco`, `2022-bronco-sport` | — | OK |
| `2011/2016-explorer` | Failed in 403 wave then OK on retry | |
| `2020-explorer` | In flight ~11:50 | Workshop active |
| `2024-bronco` | ~691 INCOMPLETE storm 09:30–11:33 | Stale PTS session; recovered; connectors progressing |
| `2005-f-150` | Sole `incomplete` | Wiring TOC 403 |

### Queue / orchestration mechanics observed

| Mechanism | Value / behavior |
|-----------|------------------|
| `queueRank` | `incomplete` (non-stale)=**0** highest; `failed`=10; `pending`=20; stale `incomplete`=30 |
| Circuit breaker | Threshold **2** auth fails / 15 min; backoff **600s**; cookie refresh on trip |
| Cookie refresh | Every **180 min** from live PTS Chrome |
| Vehicle log | **Truncated** each `yarn start` (`createWriteStream` default `'w'`) |
| CDP lock wait | **600s** default; then headless fallback for connectors |
| `failed: 127` (transient) | Overnight 403 wave; count dropped as retries succeeded |

### Network impact (operator question)

- Bursty: ~2–10 Mbps peaks with 2 workers; ~4.4 Mbps whole-machine sample during active period
- Negligible on 100+ Mbps; may notice brief contention on ≤25 Mbps
- Capture not running overnight — no extra Playwright traffic

### Engineering decisions (do NOT change during active bulk)

Per `AGENTS.md`: smallest correct change; no orchestrator refactors during subscription bulk. **Guide 04.3** (auth-aware INCOMPLETE + per-vehicle cooldown) is **planned for after bulk stops**.

### `subscriptionExpired` clarification (operator)

- URL `expiredOn=` timestamp = **browser session stale time**, not necessarily Motorcraft subscription end
- Operator confirmed: can still log in and see vehicle selection at 11:40
- Subscription **expected to end within hours** — plan cookie export + graceful stop before lapse
- When subscription truly ends: fast-fail storms will **not** self-heal until renewal

### Open operator actions

1. **Optional:** Start capture batch for 7 `needs_params` while subscription active
2. **Before sub lapse:** Export cookies; consider graceful bulk stop
3. **After sub lapse:** Renew → re-login → `export-cookies-from-chrome.js` → restart bulk
4. **No action needed** on tsconfig — `noEmit: true` fix applied

---

## Third-pass audit — gaps closed (11:55)

Items verified against full chat session; added or corrected in this pass.

### Documentation cross-links

| Doc | Update |
|-----|--------|
| [dev_guides/2026-07-09_dev_guide_04_3_incomplete_retry_storm.md](./dev_guides/2026-07-09_dev_guide_04_3_incomplete_retry_storm.md) | **New** — implementation plan for REL-08 |
| [dev_guides/README.md](./dev_guides/README.md) | 04.3 in index + dependency graph |
| [2026-07-08_pipeline_inventory_and_action_items.md](./2026-07-08_pipeline_inventory_and_action_items.md) | AM soak summary; live metrics 87 complete |
| [known_issues_and_backlog.md](./known_issues_and_backlog.md) | PIPE-01→7; REL-02/RUN-08 resolved; RUN-09; CODE-12 |

### Issues newly documented this pass

| ID | Issue |
|----|-------|
| **CODE-12** | Stray `src/**/*.js` + `test/**/*.js` from `tsc` emit (before `noEmit` fix). **Do not commit.** Delete locally; Phase G gitignore. |
| **OPS-09** | Capture log `Session totals: 0 captured, 2 failed` misleading — first-pass only; retry pass had 3 OK (OPS-07 related) |
| **OPS-10** | Orchestrator `FAIL:` line vs queue `complete` can diverge (`2022-f-250` tail CDP timeout but `complete` in JSON) — disk-truth wins |
| **MON-01** | Monitoring false positives: crown victoria 99% CPU + header-only log = deferral not hang; bronco `pid:pending` = respawn not idle |
| **MON-02** | `subscriptionExpired` URL ≠ subscription end — operator confirmed login works |

### 04.2 commit chain (on `origin/main`)

| Commit | Summary |
|--------|---------|
| `596e641` | Guide 04.2 implementation |
| `7d2f918` | Audit: runOne reaped-guard test; backlog sync |
| `097797c` | Smoke test checkpoint note |

### Uncommitted local changes (11:55)

| Path | Status |
|------|--------|
| `tsconfig.json` | Modified — `noEmit: true` (CODE-11) |
| `docs/*` | AM observations + checkpoint + backlog updates |
| `src/**/*.js`, `test/**/*.js` | **Untracked emit artifacts** — delete, do not commit |

### Operator checklist (subscription ending soon)

1. Optional capture batch for **7** `needs_params` while PTS active
2. Before lapse: export cookies; note bulk pid **75301** / log `bulk-download-20260709-0136.log`
3. After lapse: expect REL-08-class storms until renewal — **04.3 not yet implemented**
4. Do not implement 04.3 during active bulk (`AGENTS.md`)

## Fourth-pass readiness assessment (12:00)

### Documentation completeness

| Artifact | Status | Notes |
|----------|--------|-------|
| AM runtime observations | ✅ Complete | Timeline, REL-08, network, tsconfig, audits |
| Session checkpoint | ✅ Complete | Points to AM doc; 00:00 historical preserved |
| Known issues backlog | ✅ Synced | REL-08/09, CODE-11/12, PIPE/OPS updates |
| Guide 04.3 dev guide | ✅ **Implementation-ready** | Refined Step 3 root cause + Step 3b |
| Guide 04.3 context summary | ✅ **New** | Per `meta_context_gathering.md` Phase 0 |
| Guide 05 | ✅ Already implementation-ready | Independent track; larger blast radius |
| Guide 04.2 | ✅ **Closed** | 10h soak; do not re-implement |

### Accuracy corrections (live)

- `complete` **88** (was 87 at 11:40) — pipeline still progressing
- Verified OK count **21** in bulk log (was 20)
- Bulk still running pid **75301** — **do not implement 04.3 now**

### What is ready to implement **now** (safe during bulk)

| Item | Risk | Recommendation |
|------|------|----------------|
| Commit `tsconfig.json` + docs | None | **Yes** — CODE-11 + session notes |
| Delete stray `src/`/`test/` `.js` (CODE-12) | Low | **Yes** — cleanup only; running workers unaffected |
| Start capture batch (7 `needs_params`) | Ops | **Optional** — operator choice before sub lapse |
| Guide 04.3 code | **High** | **No** — requires bulk restart |
| Guide 05 code | Medium | **No** — requires capture restart; defer until planned |

### What is ready to implement **after bulk stops**

| Order | Guide | Confidence | Why |
|-------|-------|------------|-----|
| **1** | **04.3** | **High** | Focused; root cause verified; tests scoped; clear rollback |
| **2** | **05** | Medium-high | Large refactor; do after 04.3 or in parallel only if capture stopped |
| **3** | Phase G | Plan only | Watchdog, pre-commit, gitignore emit artifacts |

### Guide 04.3 — remaining refinements (minor, not blockers)

1. ~~Context summary file~~ — done
2. ~~Step 3 root cause in saveEntireWiring~~ — done
3. ~~Promote auth sidecar to core~~ — Step 3b added
4. **Optional:** add `logs/recent-auth-events.jsonl` to `env_vars.md` during implementation
5. **Optional:** one integration test with fixture simulating 3 fast INCOMPLETE cycles

**Verdict:** No further planning passes required for 04.3. Ready for Phase 0 when bulk stops.

## Fifth-pass readiness assessment (12:06)

### Live reconciliation

| Check | Result |
|-------|--------|
| Bulk lock pid | **75301** (`logs/bulk-download.lock/pid`) — continuous since 01:36 |
| Log tail | Heartbeats active; workers `2020-explorer` + `2016-police-interceptor-utility` |
| `2024-bronco` | **OK** at log line ~16783 — storm resolved; slot freed |
| Verified OK count | **21** (grep-confirmed in bulk log) |
| `complete` | **88** (`queue-status.sh`) |

### Context / dev guide verdict

| Artifact | Verdict |
|----------|---------|
| `dev_guide_04_3_context.md` | **Good** — scope, root cause, risks complete; auth sidecar promoted to core |
| `dev_guide_04_3_incomplete_retry_storm.md` | **Good** — implementation-ready; no more planning passes |
| Guide 04.2 | **Closed** — do not re-implement |
| Guide 05 | **Ready** when capture stopped — independent, larger blast radius |

### Implementation readiness

| When | Action |
|------|--------|
| **Now (bulk running)** | Commit docs + `tsconfig`; delete CODE-12 emit artifacts |
| **After bulk stops** | Guide **04.3** — single focused PR |
| **Later** | Guide 05, Phase G (gitignore `src/**/*.js`) |

**Files look good as-is.** No blocking refinements remain for 04.3 planning.

### AGENTS.md alignment

- ✅ Root cause justified for circuit/cooldown extension (691 cycles)
- ✅ Smallest correct change — new `vehicle-cooldown.js`, surgical `runOne` + `saveEntireWiring` edits
- ⚠️ "No circuit breakers during bulk" — wait until bulk stopped (not a design flaw)
- ✅ No `bulk-download.sh` refactor

---

## Changelog

| Time | Update |
|------|--------|
| 2026-07-09 12:06 | Fifth-pass audit; `2024-bronco` OK; 21 verified; commit docs + tsconfig |
| 2026-07-09 12:00 | Fourth-pass readiness; Guide 04.3 context file |
| 2026-07-09 11:55 | Third-pass audit; Guide 04.3 plan; CODE-12 emit artifacts |
| 2026-07-09 11:50 | Second-pass audit; tsconfig TS5055 fix documented |
| 2026-07-09 11:40 | Initial AM observations doc |

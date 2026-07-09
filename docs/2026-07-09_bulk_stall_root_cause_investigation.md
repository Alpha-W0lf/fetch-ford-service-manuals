# Bulk orchestrator stall — root cause investigation

**Date:** 2026-07-09 (~22:57 local investigation)  
**Incident ID:** RUN-01  
**Status:** Context complete — **fix planned in Dev Guide 04.1** (not implemented)  
**Fix guide:** [dev_guides/2026-07-09_dev_guide_04_1_orchestrator_reliability.md](./dev_guides/2026-07-09_dev_guide_04_1_orchestrator_reliability.md)

---

## Executive summary

The bulk orchestrator is **not self-managing in this failure mode**. The process (pid 28011) is **alive but frozen**: it cannot dispatch new workers, cannot update queue status, and cannot run its poll loop. Manual recovery (kill hung prune child, restart bulk) is a **workaround** for architectural gaps — not the intended steady-state.

**Root cause chain (verified):**

1. Two parallel `runOne()` jobs finish (or one finishes while the other is still running).
2. Finished job calls `pruneCdpTabs()` via **`spawnSync`** — **blocks the entire Node.js process** (no timeout).
3. Prune subprocess **hangs** on CDP (pid 49087, child of orchestrator, running 32+ minutes despite 30s connect timeout in code).
4. While blocked, the event loop cannot process the second worker's `child.on('close')` handler → second `runOne()` never completes → both `inFlight` entries stay `done: false`.
5. `reapWorkers()` **only** patches orphans when `entry.done === true` — **no PID liveness check**.
6. `startWorkers()` refuses new jobs while `inFlight.length >= PARALLEL` → **zero throughput** with queue stuck on `downloading`.

This is a **design gap in Guide 04 orchestrator**, not operator error and not the Terminal.app supervision issue (that is a separate, solved problem).

---

## What we observed (evidence)

### Process snapshot (~22:57)

| Process | PID | PPID | Age | Role |
|---------|-----|------|-----|------|
| `bulk-orchestrator.js` | 28011 | 1 | ~95 min | **Frozen** in `spawnSync(prune)` |
| `npm exec ts-node prune-cdp-tabs` | 49065 | **28011** | ~33 min | Orchestrator's prune child — **hung** |
| `ts-node prune-cdp-tabs` | 49087 | 49065 | ~33 min | Actual prune script |
| `prune-cdp-tabs` (×2) | 91074, 91141 | 91052, 91119 | **3h23m** | **Separate session** (s022) — pre-existing orphans, not this orchestrator's children |
| `capture-params --all` | 29405 | — | ~95 min | Healthy; CDP lock free during retry pass |
| `yarn start` workers | — | — | — | **0** |

`curl http://127.0.0.1:9222/json/version` — **CDP responsive** while prune hung → hang is not "Chrome down"; it is **stuck inside prune** after partial connect or during `browser.close()`.

### Queue state

| Vehicle | Queue status | Worker log end state | Gaps on disk |
|---------|--------------|----------------------|--------------|
| `2018-expedition-max` | `downloading` | **Normal exit** — "Manual downloaded, closing browser", "Capture incomplete: 1 gap" | 1 |
| `2016-f-250` | `downloading` | **Abnormal** — mid-connector "Saving connector …", no closing message | 8 |

### Bulk orchestrator log

Last events for current round (no completion lines):

```
START 2016-f-250 (parallel slot)
...
START 2018-expedition-max (parallel slot)
```

No matching `OK:`, `INCOMPLETE:`, or `FAIL:` for this round — `runOne()` never reached post-yarn status logging.

### Vehicle log timestamps

- `logs/2016-f-250.log` — mtime **22:25:18**, frozen mid-write
- `logs/2018-expedition-max.log` — mtime **22:25:19**, completed normally

Prune child 49065 started ~**22:25** — aligns with worker completion window.

---

## Code path analysis

### Intended flow (`lib/bulk-orchestrator-lib.js`)

```
startWorkers()
  → runOne() [async, fire-and-forget promise]
       → spawnYarnStart() [await yarn child]
       → pruneCdpTabs()   [spawnSync — BLOCKS ENTIRE NODE PROCESS]
       → resolve disk status
       → markStatus(complete|incomplete|failed)
       → return exit code
       → entry.done = true

orchestratorTick() [every 5s while workers running]
  → reapWorkers()  [only acts on entry.done === true]
  → startWorkers() [blocked if inFlight.length >= PARALLEL]
```

### Gap 1: `spawnSync` blocks the event loop

```287:300:lib/bulk-orchestrator-lib.js
function pruneCdpTabs(config, deps = DEFAULT_DEPS) {
  const logPath = path.join(config.logDir, "cdp-tab-prune.log");
  const r = deps.spawnSync(
    "npx",
    ["ts-node", path.join(config.root, "scripts/prune-cdp-tabs.ts")],
    ...
  );
  fs.appendFileSync(logPath, `${r.stdout || ""}${r.stderr || ""}`);
}
```

Called synchronously inside `async function runOne()` **after** `await spawnYarnStart()`:

```396:398:lib/bulk-orchestrator-lib.js
  const exitCode = await spawnYarnStart(config, yarnArgs, logPath, deps);

  pruneCdpTabs(config, deps);
```

**Consequence with `PARALLEL=2`:** When worker A finishes and enters `spawnSync(prune)`, worker B's `child.on('close')` callback **cannot run** until `spawnSync` returns. If prune hangs, **both slots are effectively dead** even if B's yarn already exited.

This violates the assumption that parallel workers are independent.

### Gap 2: No orchestrator-level timeout on prune

- `pruneOrphanCdpTabs()` uses `CDP_CONNECT_TIMEOUT_MS` default **30s** on `connectOverCDP`.
- `spawnSync` has **no timeout** — if the child hangs past Playwright's timeout (e.g. on `browser.close()`, `page.close()`, or npm/ts-node startup), the parent waits **forever**.
- Observed: prune child **49087 ran 33+ minutes** — proves timeout did not terminate the process.

### Gap 3: `reapWorkers` does not detect dead workers

```461:474:lib/bulk-orchestrator-lib.js
async function reapWorkers(config, state, deps = DEFAULT_DEPS) {
  const still = [];
  for (const entry of state.inFlight) {
    if (!entry.done) {
      still.push(entry);   // ← waits forever; no PID check
      continue;
    }
    fixOrphanDownloading(config, entry.vid, entry.exitCode ?? 1, deps);
    ...
  }
  state.inFlight = still;
}
```

`inFlight` entries store `{ vid, done, exitCode }` — **no yarn child PID**.

Guide 04's `fixOrphanDownloading()` only runs **after** `done: true`. It patches queue when status is still `downloading` at reap time — but reap never reaches that code while `done` is false.

**Unit tests cover `fixOrphanDownloading` in isolation** (`test/bulk-orchestrator.test.ts`) but **not** the stall case `done: false` + dead yarn + hung prune.

### Gap 4: Triple prune invocation under CDP contention

Prune runs from **three places**:

| Caller | When | Async/sync |
|--------|------|------------|
| `src/index.ts` | End of each `yarn start` wiring phase | async `await pruneOrphanCdpTabs()` |
| `bulk-orchestrator-lib.js` | After each `yarn start` in `runOne` | **`spawnSync`** |
| `bulk-download.sh` `cleanup` trap | On orchestrator exit | background `|| true` |

With parallel workers + capture retry pass on CDP, multiple prune processes can contend for `:9222`. Older prune PIDs from **prior sessions** (91074, 91141 on s022, 3h+ uptime) add noise but are not the direct parent of this stall — orchestrator child **49065** is.

### Gap 5: Queue `downloading` not self-healed during stall

`markStatus("downloading")` is set at worker start. Final status is set only at end of `runOne()` **after** prune. If `runOne` never completes:

- Queue stays `downloading` indefinitely
- `orchestratorTick` keeps sleeping 5s, never dispatches
- `maybePeriodicMaintenance` skips reconcile while `running !== 0` (inFlight length 2)

```281:285:lib/bulk-orchestrator-lib.js
function maybePeriodicMaintenance(config, state, running, deps) {
  if (running !== 0) return;  // ← reconcile blocked while "workers" in flight
  ...
}
```

---

## Why manual steps were suggested (and what they actually do)

| Suggested step | What it addresses | Why it's not "self-managing" |
|----------------|-------------------|------------------------------|
| **Kill hung prune PIDs** | Unblocks orchestrator `spawnSync` so event loop can resume | Orchestrator should timeout/kill prune itself |
| **Restart bulk** | Clears corrupted `inFlight` memory state; `reconcile-queue` on exit fixes queue | Should recover in-process via dead-worker detection |
| **Don't restart from Cursor shell** | **Unrelated to this stall** — prevents process-group kill on IDE session end (`AGENTS.md`) | Still valid invariant for any restart |

Killing **only** prune might allow 2018's `runOne` to complete and patch queue. **2016** may still be stuck if yarn exited without firing `close` while event loop was blocked — restart may still be required. That uncertainty is itself a reliability gap.

---

## What Guide 04 fixed vs what it did not

| Guide 04 item | Covers this stall? |
|---------------|-------------------|
| `fixOrphanDownloading` on reap | **Partial** — only when `done: true` |
| Node orchestrator + tests | **Partial** — tests mock `spawnSync` as instant |
| Thin bash wrapper | Yes — unrelated |
| Graceful SIGINT shutdown | **No** — stall is not a signal |

---

## Failure mode diagram

```
Worker A (2018) yarn exits
    │
    ▼
runOne(A) → spawnSync(prune) ──────────────┐
    │                                       │ BLOCKS Node event loop
    │                                       │ (no timeout)
    ▼                                       │
prune child hangs 33+ min ◄─────────────────┘
    │
    │  Worker B (2016) yarn exits (or hangs)
    │  close event queued but NOT processed
    ▼
inFlight: [A: done=false, B: done=false]
    │
    ▼
startWorkers: inFlight.length >= 2 → no dispatch
reapWorkers: done=false → no orphan fix
maybePeriodicMaintenance: running=2 → no reconcile
    │
    ▼
STALL: orchestrator alive, zero throughput, queue wrong
```

---

## Open questions (resolved — see Guide 04.1)

| # | Question | Resolution |
|---|----------|------------|
| 1 | Does `browser.close()` in `pruneOrphanCdpTabs` finally block without timeout when CDP is busy with capture? | **Likely yes** — Step 5 adds 10s `Promise.race` timeout in Guide 04.1 |
| 2 | Should orchestrator prune at all? | **No** — remove from `runOne`; keep worker + shutdown prune |
| 3 | Replace `spawnSync` prune with async + timeout? | **N/A** — delete orchestrator prune entirely |
| 4 | Track child PID in `inFlight`? | **Yes** — `reapStaleWorkers` via `process.kill(pid, 0)` |
| 5 | Reconcile while `inFlight` has dead PIDs? | **`reapStaleWorkers`** patches per-vehicle from disk; fleet reconcile stays idle-only |

---

## Recommended fix themes (implemented in Guide 04.1)

| Theme | Rationale |
|-------|-----------|
| **Never `spawnSync` prune in hot path** | Unblocks event loop; enables true parallel worker completion |
| **PID-aware `inFlight` + stale worker reap** | Self-heal when yarn dead but `done` false |
| **Disk-truth stale status** | Avoid marking `incomplete` as `failed` when exit code is ambiguous |
| **Bounded CDP disconnect** | Prevent hung prune subprocess (RUN-02) |
| **Tests for stall scenario** | Mock dead pid; assert no prune `spawnSync`; disk-truth patch |

**Implementation guide:** [2026-07-09_dev_guide_04_1_orchestrator_reliability.md](./dev_guides/2026-07-09_dev_guide_04_1_orchestrator_reliability.md) (**implementation-ready**, pass 3).

---

## Changelog

| Date | Update |
|------|--------|
| 2026-07-09 | Dev Guide 04.1 pass 3 — open questions resolved |

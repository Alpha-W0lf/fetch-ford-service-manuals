# CDP tab hygiene

**Canonical rules** for pruning tabs in live PTS Chrome (`:9222`).  
**Code:** `lib/cdp-tab-hygiene.js` · **Prune:** `src/cdpConnectorPage.ts` → `pruneOrphanCdpTabs`

---

## URL classes

| URL pattern | Class | Close during active connector job? | Close when idle? |
|-------------|-------|:--------------------------------:|:----------------:|
| `about:blank` | Safe orphan | **Yes** | Yes |
| `chrome-error://*` | Error tab | **Yes** | Yes |
| `*/wiring/face*` | Connector capture | **No** | Only overflow / error variant |
| Other PTS pages | Protected | **No** | No (not in disposable set) |

`isConnectorCaptureTab(url)` — matches `/wiring/face` (case-insensitive).

---

## Prune modes

### Active connector job

When `cdp-chrome.lock` holder starts with `connector-`:

- Close **only** `isSafePruneDuringConnectorJob(url)` → `about:blank` and `chrome-error://`
- **Never** close `/wiring/face` tabs — worker may be navigating them

**Incident (2026-07-08):** Aggressive prune closed a live connector tab → worker failure. This mode is the fix.

### Idle (no connector lock)

1. Trim connector tab overflow beyond `maxConnectorTabs` (default `PARALLEL` or 2)
2. Close disposable tabs unless `shouldSkipDisposableTabClose` (kept connector set or live face URL)

---

## Lock coordination

| Process | Lock scope | Wait env |
|---------|------------|----------|
| Bulk connector PDF | Per connector via `withCdpChromeLock` | `CDP_LOCK_WAIT_MS` |
| Param capture (1st pass) | Per vehicle | `CDP_LOCK_YIELD_MS` then defer |
| Param capture (retry) | Per vehicle | `CDP_LOCK_WAIT_MS` |

See [architecture.md](./architecture.md) and [env_vars.md](./env_vars.md).

---

## Related

- [pipeline-scheduling.md](../pipeline-scheduling.md) — operator coordination
- Dev Guide 03 — tests for tab hygiene and defer policy

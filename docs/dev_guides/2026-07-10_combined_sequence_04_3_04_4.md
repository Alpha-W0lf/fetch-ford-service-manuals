# Combined sequence — Guides 04.3 + 04.4

**Date:** 2026-07-10  
**Status:** Operator-agreed sequence (pending plan-package sign-off)  
**Context:** Subscription may be lapsed — live bulk soak between guides has low value.

---

## Recommendation (revised)

**Compress the gap between 04.3 and 04.4; do not merge the guides.**

| Approach | Verdict |
|----------|---------|
| Merge 04.3 + 04.4 into one release | **No** — too hard to bisect regressions |
| Long live soak between guides | **Defer** if subscription lapsed — no productive downloads to observe |
| 04.3 → 04.4 back-to-back in one maintenance window | **Yes** — recommended |
| Separate commits per guide | **Yes** — revert-friendly |

---

## Sequence

```text
1. Operator recovery (locks + reconcile) — no code
2. Phase 0: yarn test + yarn typecheck green
3. Implement + commit Guide 04.3 — **DONE** (2026-07-10)
4. Verify: yarn test/typecheck; review vehicle-cooldown API matches 04.4 contract — **DONE**
5. Implement + commit Guide 04.4 (extends cooldown for auth-budget-stop)
6. Phase 0 repro matrix: unit/mock tests NOW; live PTS cases when subscription renews
7. Optional bulk restart — only if subscription renewed OR operator accepts auth-fail idle cycling with cooldown protection
```

---

## Subscription-lapsed operating mode

If the paid PTS subscription has truly expired (operator belief, 2026-07-10):

| Effect | Implication |
|--------|-------------|
| Downloads will fail auth until renewal | Bulk restart before renewal has **low throughput value** |
| `connectorPreflight` may not clear cooldowns | Recovery signal unavailable until live content access returns |
| 04.3 + 04.4 still valuable | Prevents orchestrator crash, protects ~15.6k partial PDFs, stops slot/worker waste |
| Live repro matrix | **Mock/unit tests during implementation**; live cases deferred until renewal |
| `subscriptionExpired` URL | May indicate true lapse **or** stale session — code stays cause-agnostic |

**Do not** infer subscription state from a single redirect. When uncertain, treat as opaque auth failure and rely on operator renewal confirmation before expecting completes.

---

## What changes vs prior plan

| Prior | Revised |
|-------|---------|
| 04.4 after multi-hour 04.3 soak | 04.4 immediately after 04.3 tests pass |
| Live four-case repro before 04.4 code | Mock/unit repro during 04.4 impl; live repro when subscription live |
| Author 04.4 guide after soak | **04.4 formal dev guide authored now** (this pass) |

---

## Plan packages

| Guide | Package |
|-------|---------|
| 04.3 | [2026-07-10_plan_package_04_3_incomplete_retry_storm.md](./2026-07-10_plan_package_04_3_incomplete_retry_storm.md) |
| 04.4 | [2026-07-10_plan_package_04_4_priority_family_failure_policy.md](./2026-07-10_plan_package_04_4_priority_family_failure_policy.md) |

Approve both before implementation, or approve 04.3 first and 04.4 before its commit.

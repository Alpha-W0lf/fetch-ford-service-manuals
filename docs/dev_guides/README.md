# Dev guides — foundation hardening

**Context:** [../2026-07-08_codebase_foundation_context_assessment.md](../2026-07-08_codebase_foundation_context_assessment.md)  
**Canonical reference:** [../reference/README.md](../reference/README.md)  
**Execution workflow:** `second_brain/docs/guides/prompt_follow_dev_guide.md`

## Workflow distinction

| Artifact | Purpose | When to create |
|----------|---------|----------------|
| **Context assessment** | Why + honest scores + phased roadmap | Before any dev guide |
| **Dev guide** | Blueprint: objective, checklist, verification, blast radius | Before implementation of that unit |
| **Reference docs** | Frozen contracts (`docs/reference/*`) | Guide 01 **executed** these |
| **Implementation** | Code/tests/refactors | Only after Tom says "follow dev guide N" |

**Do not** execute Guides 02–06 until explicit go-ahead.

## Guide index

| # | File | Type | Status | Safe during active bulk? |
|---|------|------|--------|--------------------------|
| 01 | [2026-07-08_dev_guide_01_architecture_reference.md](./2026-07-08_dev_guide_01_architecture_reference.md) | Docs | **Executed** | Yes |
| 02 | [2026-07-08_dev_guide_02_test_harness_and_pure_libs.md](./2026-07-08_dev_guide_02_test_harness_and_pure_libs.md) | Code + tests | **Executed** | Yes (if parity tests pass) |
| 03 | [2026-07-08_dev_guide_03_cdp_coordination.md](./2026-07-08_dev_guide_03_cdp_coordination.md) | Code + tests | **Executed** | Yes |
| 04 | [2026-07-08_dev_guide_04_orchestrator_split.md](./2026-07-08_dev_guide_04_orchestrator_split.md) | Major refactor | **Executed** (live soak 2026-07-08) | **No** (during impl) |
| 04.1 | [2026-07-09_dev_guide_04_1_orchestrator_reliability.md](./2026-07-09_dev_guide_04_1_orchestrator_reliability.md) | Reliability fix | **Executed** (2026-07-09) | **No** (during impl) |
| 04.2 | [2026-07-09_dev_guide_04_2_unsupervised_reliability.md](./2026-07-09_dev_guide_04_2_unsupervised_reliability.md) | Reliability | **Executed** (2026-07-09) | **No** (during impl) |
| **04.3** | [2026-07-09_dev_guide_04_3_incomplete_retry_storm.md](./2026-07-09_dev_guide_04_3_incomplete_retry_storm.md) | Reliability | **Executed** (2026-07-10) — REL-08; [context](./2026-07-09_dev_guide_04_3_context.md) |
| **04.4** | [2026-07-10_dev_guide_04_4_priority_family_failure_policy.md](./2026-07-10_dev_guide_04_4_priority_family_failure_policy.md) | Reliability | **Executed** (2026-07-10) — auth-budget stop, early failure gaps, SEC-01; [plan package](./2026-07-10_plan_package_04_4_priority_family_failure_policy.md) |
| **04.4 context** | [2026-07-10_dev_guide_04_4_priority_family_failure_context.md](./2026-07-10_dev_guide_04_4_priority_family_failure_context.md) | Context | **Ready** (92/100) |
| 05 | [2026-07-08_dev_guide_05_capture_modularization.md](./2026-07-08_dev_guide_05_capture_modularization.md) | Refactor | **Implementation-ready** | Yes (bulk can run) |
| 06 | [2026-07-08_dev_guide_06_legacy_capture.md](./2026-07-08_dev_guide_06_legacy_capture.md) | Feature | **Plan** — needs Guide 05 + [legacy_pts_capture.md](../reference/legacy_pts_capture.md) | After capture restart |

## Future (not yet a dev guide)

| Item | Scope |
|------|-------|
| **Phase G** | launchd FDA proof, pre-commit hooks, health script consolidation |

## Dependency graph

```
01 (executed) → 02 → 03 → 04 (executed) → 04.1 (executed) → 04.2 (executed)
                      ↘ 04.3 (executed 2026-07-10) — REL-08 + stream guard
                         ↘ 04.4 (executed 2026-07-10) — auth-budget + early-failure gaps
                      ↘ 05 (implementation-ready) → 06 (plan)
                      ↘ Phase G (watchdog, hooks)
```

## Ready for implementation?

| Question | Answer |
|----------|--------|
| Append RUN-01 fix to Guide 04? | **No** — Guide 04 executed; use **04.1** |
| Ready for Guide 04.1 code? | **Done** — executed `6c15180`; early soak positive |
| Ready for Guide 04.2? | **Done** — executed 2026-07-09; 84 tests |
| More planning passes for Guide 05? | **No** — ready when capture stopped |
| Ready for Guide 04.3 code? | **Done** — executed 2026-07-10; 98 tests |
| Ready for Guide 04.4 code? | **Done** — executed 2026-07-10; 111 tests |
| Ready for Guide 05 code? | **Yes**, after capture stopped + Tom says "follow dev guide 05" |
| Ready for Guide 06? | **No** — needs Guide 05 executed + operator-filled `legacy_pts_capture.md` |
| Numbered dev guides after 06? | **None.** Phase G (hooks, watchdog, logging) is **not** a numbered guide yet. |

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
| 03 | [2026-07-08_dev_guide_03_cdp_coordination.md](./2026-07-08_dev_guide_03_cdp_coordination.md) | Code + tests | **Ready** (plan refined) | Yes |
| 04 | [2026-07-08_dev_guide_04_orchestrator_split.md](./2026-07-08_dev_guide_04_orchestrator_split.md) | Major refactor | Plan only | **No** |
| 05 | [2026-07-08_dev_guide_05_capture_modularization.md](./2026-07-08_dev_guide_05_capture_modularization.md) | Refactor | Plan only | After capture restart |
| 06 | [2026-07-08_dev_guide_06_legacy_capture.md](./2026-07-08_dev_guide_06_legacy_capture.md) | Feature | Plan only | After capture restart |

## Future (not yet a dev guide)

Phase G from context assessment: pre-commit hooks, watchdog removal, `pipeline-health.sh` consolidation — defer until after Guide 02–03 or post-subscription.

## Dependency graph

```
01 (executed) → 02 → 03 → 04 (bulk stopped)
                      ↘ 05 → 06
```

## Ready for implementation?

| Question | Answer |
|----------|--------|
| More planning passes? | **No** |
| Ready for Guide 02 code? | **Yes, after** Tom approves `schemas.md` + says "follow dev guide 02" |
| Ready for Guides 03–06? | **No** — sequential; explicit go-ahead each time |
| Safe during active bulk? | Guide 02–03 yes; Guide 04 **no** |

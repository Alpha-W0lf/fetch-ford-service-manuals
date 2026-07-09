# Reference documentation

**Canonical architecture and contracts** for the Ford PTS bulk download fork.

| Document | Purpose |
|----------|---------|
| [architecture.md](./architecture.md) | System components, locks, cookie flow, blessed commands |
| [queue_state_machine.md](./queue_state_machine.md) | `vehicles.json` status transitions and writers |
| [schemas.md](./schemas.md) | JSON shapes, gap blocking rules (canonical) |
| [env_vars.md](./env_vars.md) | Environment variable catalog |
| [cdp_tab_hygiene.md](./cdp_tab_hygiene.md) | CDP tab prune rules and URL classes |
| [legacy_pts_capture.md](./legacy_pts_capture.md) | Pre-2003 PTS exploration template (Guide 06 gate) |

**Operator runbooks** (summaries + links, not duplicate architecture):

- [../PIPELINE_OPS.md](../PIPELINE_OPS.md) — operator index
- [../../BULK_DOWNLOAD_GUIDE.md](../../BULK_DOWNLOAD_GUIDE.md) — subscription strategy and troubleshooting
- [../pipeline-scheduling.md](../pipeline-scheduling.md) — scheduling, locks, maintenance intervals
- [../2026-07-09_pipeline_session_checkpoint.md](../2026-07-09_pipeline_session_checkpoint.md) — **latest session** (04.1, REL gaps)
- [../2026-07-08_pipeline_runtime_observations.md](../2026-07-08_pipeline_runtime_observations.md) — prior session notes

**Foundation planning & backlog:**

- [../2026-07-08_codebase_foundation_context_assessment.md](../2026-07-08_codebase_foundation_context_assessment.md)
- [../known_issues_and_backlog.md](../known_issues_and_backlog.md) — **issue & tech-debt registry**
- [../dev_guides/2026-07-09_dev_guide_04_1_orchestrator_reliability.md](../dev_guides/2026-07-09_dev_guide_04_1_orchestrator_reliability.md) — RUN-01 fix (**executed** `6c15180`)
- [../dev_guides/README.md](../dev_guides/README.md) — implementation blueprints (01–04.1 executed; 05–06 planned)

**Agent invariants:** [../../AGENTS.md](../../AGENTS.md)

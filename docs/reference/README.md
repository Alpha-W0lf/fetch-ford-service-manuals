# Reference documentation

**Canonical architecture and contracts** for the Ford PTS bulk download fork.

| Document | Purpose |
|----------|---------|
| [architecture.md](./architecture.md) | System components, locks, cookie flow, blessed commands |
| [queue_state_machine.md](./queue_state_machine.md) | `vehicles.json` status transitions and writers |
| [schemas.md](./schemas.md) | JSON shapes, gap blocking rules (canonical) |
| [env_vars.md](./env_vars.md) | Environment variable catalog |
| [cdp_tab_hygiene.md](./cdp_tab_hygiene.md) | CDP tab prune rules and URL classes |

**Operator runbooks** (summaries + links, not duplicate architecture):

- [../PIPELINE_OPS.md](../PIPELINE_OPS.md) — operator index
- [../../BULK_DOWNLOAD_GUIDE.md](../../BULK_DOWNLOAD_GUIDE.md) — subscription strategy and troubleshooting
- [../pipeline-scheduling.md](../pipeline-scheduling.md) — scheduling, locks, maintenance intervals

**Foundation planning:**

- [../2026-07-08_codebase_foundation_context_assessment.md](../2026-07-08_codebase_foundation_context_assessment.md)
- [../dev_guides/README.md](../dev_guides/README.md) — implementation blueprints (01–03 executed; 04–06 plans)

**Agent invariants:** [../../AGENTS.md](../../AGENTS.md)

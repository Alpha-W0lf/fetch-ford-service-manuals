## Solidify pass 1 (2026-07-10 11:50)

### Findings
- [gap]: The cooldown API named a generic outcome method but left its accepted auth classes, mutation rule, and reset behavior ambiguous.
- [risk]: The guide placed dispatch ordering under `orchestratorTick`, while the actual job-selection hook is `startWorkers` → `nextJob`.
- [gap]: The durable auth-event sidecar needed a precedence rule so historical evidence could not misclassify a new non-auth worker result.
- [test]: Wiring skip-path coverage had no dedicated target file.

### Artifact sections touched
- `🏗️ Architectural pattern`
- `📋 Implementation checklist`
- `⚠️ Blast radius & risks`
- `Status`

### Changes made
- Added formal dev-guide metadata and a frozen state-machine rule for `recordOutcome`.
- Pinned the cooldown merge to `startWorkers`, the recovery clear to verified `connectorPreflight()` success, and clarified evidence precedence.
- Added the dedicated wiring-gap test target and complete runtime-state rollback cleanup.

### Verification evidence
- `lib/bulk-orchestrator-lib.js`: `runOne` has the INCOMPLETE early return; `startWorkers` owns the `nextJob` call; `connectorPreflight` sits beside the existing circuit-stamp clearing path.
- `src/captureGaps.ts`: canonical auth classifications and wiring gap helpers are present.
- `src/wiring/saveEntireWiring.ts`: `ignoreSaveErrors` catches the affected skip path.

### Readiness score: 84/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 17/20 | Main steps are actionable; final exact helper signatures still require Phase 0 source reading. |
| Path / symbol verification | 17/20 | Main paths verified; the new wiring test must prove the smallest test seam. |
| Risk & blast radius per step | 18/20 | Cooldown, circuit, and reaper interactions are now explicit. |
| Test & verification plan | 16/20 | Test intent is strong but needs exact fixture/mocking strategy. |
| Checklist completeness & order | 16/20 | Bulk-stop gate is clear; Phase 0 command/rollback rehearsal needs expansion. |

### Blockers (human required?)
- None. The guide requires further refinement before it may be marked Ready; implementation remains prohibited during the active bulk run.

## Solidify pass 2 (2026-07-10 11:53)

### Findings
- [inaccuracy]: The guide claimed that every auth-class `saveEntireWiring` skip could use an existing helper, but the actual helper set has page and connector IDs only; it has no separate probe or LocIndex ID.
- [risk]: A broad outer catch record can duplicate a gap that `savePage` or `saveConnector` already persisted.
- [test]: The guide needed exact expected IDs and an assertion that auth accounting is not duplicated.

### Artifact sections touched
- `📋 Implementation checklist`
- `Status`

### Changes made
- Replaced the inaccurate generic helper instruction with a deterministic Page/BasicPage, connector-probe, and LocIndex ID mapping.
- Added a no-duplicate-record constraint and explicit test assertions for one stable auth gap versus non-auth ignored failures.

### Verification evidence
- `src/captureGaps.ts` exports only `wiringPageGapId(cell, page)` and `wiringConnectorGapId(cell, connectorName)`.
- `src/wiring/saveEntireWiring.ts` has one outer `ignoreSaveErrors` catch across Page, Connectors, and LocIndex work.
- `src/wiring/savePage.ts` and `src/wiring/saveConnector.ts` already use the canonical helpers for lower-level artifacts.

### Readiness score: 88/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 18/20 | The implementation now has deterministic classifications and IDs. |
| Path / symbol verification | 18/20 | Current source paths and helper APIs are verified; exact test doubles remain Phase 0 work. |
| Risk & blast radius per step | 18/20 | Duplicate accounting and scheduler/reaper interactions are explicitly constrained. |
| Test & verification plan | 17/20 | Concrete expected records are defined; a full Phase 0 fixture design remains. |
| Checklist completeness & order | 17/20 | Needs a final preflight/rollback rehearsal and linked-context certification. |

### Blockers (human required?)
- None. A final guide pass is still required, and the linked context summary must be formalized and solidified before this guide can be marked Ready.

## Solidify pass 3 (2026-07-10 11:56)

### Findings
- [inaccuracy]: The prior deterministic mapping still risked duplicating Page/BasicPage and ordinary connector gaps, because those lower-level save functions already own their capture records.
- [design]: Connector portal preflight and connector auth-streak failures need distinct stable records, but `saveEntireWiring` currently has no state separating them.
- [scope]: A single local readiness boolean is sufficient; no new persistence layer or scheduler behavior is justified.

### Artifact sections touched
- `📋 Implementation checklist`
- `Status`

### Changes made
- Narrowed the outer catch accounting to only gaps not already recorded by lower-level functions.
- Specified `connectorPortalReady` and dedicated probe/auth-streak IDs, preserving the original per-connector record path.
- Expanded the focused test matrix to assert non-duplication across all four outcomes.

### Verification evidence
- `src/wiring/savePage.ts` already records `wiringPageGapId(doc.Number, pageNumber)` under ignored failures.
- `src/wiring/saveConnector.ts` already records individual connector gaps, but throws `PtsAuthError` after its consecutive-auth threshold before recording that terminal condition.
- `src/wiring/saveEntireWiring.ts` owns `probeConnectorAccess()` and the encompassing catch, so it is the smallest appropriate owner for the readiness flag and terminal records.

### Readiness score: 91/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 19/20 | The state, branches, and records are now explicit. |
| Path / symbol verification | 19/20 | Affected call sites and current helper APIs are source-verified. |
| Risk & blast radius per step | 18/20 | Duplicate-record and reaper/circuit interactions are constrained. |
| Test & verification plan | 18/20 | Focused test cases are defined; fixture mechanics remain to be checked in Phase 0. |
| Checklist completeness & order | 17/20 | Context certification and operational rehearsal remain before Ready. |

### Blockers (human required?)
- None. The guide remains in Refining until its linked context summary completes its own certification and the final guide validation pass is performed.

## Solidify pass 4 (2026-07-10 12:00)

### Findings
- [API]: A file-backed cooldown module needed a construction/lifetime contract; otherwise implementation could repeatedly reload state during scheduling or hide I/O in global state.
- [integration]: The documented clear call lacked the required `state` plumbing through `connectorPreflight`, its startup call, and periodic-refresh call.
- [test]: The plan named test intent but not the existing test language, config boundary, capture-gap import, or stopped-run validation commands.

### Artifact sections touched
- `🏗️ Architectural pattern`
- `📋 Implementation checklist`
- `✅ Verification & definition of done`
- `Status`

### Changes made
- Specified one per-orchestrator cooldown store constructed in `runOrchestrator` and retained in state.
- Pinned configuration, capture-gap import, preflight state plumbing, and all affected call sites.
- Replaced the inconsistent JavaScript test target with the repository's TypeScript/Vitest convention and added typecheck/reconcile/health validation.

### Verification evidence
- `lib/bulk-orchestrator-lib.js:40–91` owns env configuration; `runOrchestrator` initializes the shared state; `startWorkers` owns `nextJob`.
- `connectorPreflight` has startup and periodic-refresh call sites; it currently clears fleet circuit stamps on success.
- `package.json` runs Vitest and the existing `test/` suite uses `*.test.ts`.
- `scripts/capture-gaps-lib.js` exports `readCaptureGaps` and `blockingGaps`.

### Readiness score: 96/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 20/20 | Every state transition and hook has a named owner. |
| Path / symbol verification | 19/20 | Source paths/call sites are verified; new module is intentionally new. |
| Risk & blast radius per step | 19/20 | State, preflight, circuit, and reaper interactions are explicit. |
| Test & verification plan | 19/20 | Unit, integration, regression, typecheck, and restart checks are concrete. |
| Checklist completeness & order | 19/20 | Context gate, implementation order, and rollback are complete. |

### Why not 100%
- The plan intentionally leaves the conservative numeric defaults subject to Phase 0 test confirmation and cannot prove Ford's live recovery behavior without a stopped-run controlled test.

### Blockers (human required?)
- None. The guide is eligible for formal validation and readiness certification; implementation still requires the user's plan-package approval and a stopped bulk run.

## Solidify pass 5 (2026-07-10 12:00)

### Findings
- [certification]: The existing checklist put all test work after implementation, failing the required test-driven acceptance criterion.
- [clarity]: The durable-event checklist still contained its superseded “sidecar OR current log” wording, which contradicted the frozen evidence precedence.

### Artifact sections touched
- `📋 Implementation checklist`
- `Status`

### Changes made
- Reordered focused, isolated test creation before all implementation steps.
- Moved post-change assertions into a dedicated test-completion step and replaced the ambiguous evidence wording with the final precedence rule.

### Verification evidence
- `package.json` runs `vitest run`; all existing repository tests are TypeScript `*.test.ts`.
- `test/bulk-orchestrator.test.ts`, `test/captureGaps.test.ts`, and the planned isolated test files cover the affected module boundaries.

### Readiness score: 97/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 20/20 | The order, owners, and state transitions are explicit. |
| Path / symbol verification | 19/20 | Existing paths/call sites verified; planned module/test files are intentionally new. |
| Risk & blast radius per step | 19/20 | Scheduler, circuit, preflight, and worker ownership constraints are explicit. |
| Test & verification plan | 20/20 | Isolated red tests precede implementation; regression and operator checks follow. |
| Checklist completeness & order | 19/20 | Context prerequisite, implementation order, rollback, and docs are complete. |

### Why not 100%
- Numeric defaults and the live PTS recovery observation must still be confirmed by the explicit stopped-run Phase 0 test; the plan correctly does not pretend runtime proof already exists.

### Blockers (human required?)
- None. The guide is eligible for validation and readiness certification. Implementation remains prohibited until the user approves the plan package and the active bulk run is stopped.

## Solidify pass 6 (2026-07-10 12:23)

### Findings
- [operator safety]: The guide incorrectly implied that its remaining documentation validation required stopping a healthy bulk run.
- [gate clarity]: Planning safety and implementation safety are separate conditions; conflating them delays low-risk review without improving runtime safety.

### Artifact sections touched
- `📚 Critical Context & References`
- `Status`

### Changes made
- Split the planning gate from the implementation gate.
- Explicitly allow documentation review, source inspection, and plan validation while bulk runs, while retaining the stop requirement for source edits, live reproduction, test execution against the runtime, and restart.

### Verification evidence
- `AGENTS.md` permits documentation and evidence gathering during active bulk while prohibiting active-run orchestration changes.
- The dev guide's affected source areas are all runtime-sensitive: orchestrator dispatch, wiring capture, and persisted state. Those remain behind the implementation gate.

### Readiness score: 97/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 20/20 | Steps, owners, and test order are explicit. |
| Path / symbol verification | 19/20 | Existing paths/call sites are verified; planned files are new by design. |
| Risk & blast radius per step | 19/20 | Planning and runtime gates are now correctly separated. |
| Test & verification plan | 20/20 | Isolated tests precede implementation; regression and operator checks follow. |
| Checklist completeness & order | 19/20 | Rollback and approval gates remain clear. |

### Why not 100%
- The stopped-run Phase 0 test must still confirm chosen numeric defaults and the live PTS recovery transition; no documentation pass can substitute for that evidence.

### Blockers (human required?)
- None for documentation work. Implementation remains blocked by the user's plan approval and deliberate bulk stop.

## Solidify pass 7 (2026-07-10 21:16)

### Findings
- [runtime regression]: The active bulk run crashed with unhandled `ERR_STREAM_WRITE_AFTER_END`, leaving a stale lock and two queue rows marked `downloading`.
- [root cause]: `spawnYarnStart` pipes child output to a log stream, then its `error` handler ends that stream before delayed pipe writes complete; `close` also owns normal shutdown.
- [scope]: This is a direct orchestrator reliability defect exposed by the same auth-failure churn, so excluding it from 04.3 would leave the pipeline vulnerable after cooldown work ships.

### Artifact sections touched
- `Scope tiers`
- `📋 Implementation checklist`
- `✅ Verification & definition of done`
- `Status`

### Changes made
- Added a smallest-correct log-stream lifecycle guard: error settles the result, close owns normal end, and the destination stream has a handled error listener.
- Added a deterministic delayed-stream regression test before implementation.
- Returned the guide to a lower readiness score pending stream-mock test seam confirmation.

### Verification evidence
- `logs/bulk-download-20260710-0022.log` ends in unhandled `ERR_STREAM_WRITE_AFTER_END`.
- `lib/bulk-orchestrator-lib.js:438–467` confirms the unsafe `error`-path `logStream.end()` and duplicate end ownership.
- Live health at ~21:16 shows no orchestrator/workers, a stale bulk lock, and two orphaned `downloading` statuses.

### Readiness score: 94/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 19/20 | Stream ownership change is precise; mock construction needs final test confirmation. |
| Path / symbol verification | 19/20 | Crash site and all affected call paths are source-verified. |
| Risk & blast radius per step | 18/20 | Change is small but lies on the process-lifecycle boundary. |
| Test & verification plan | 19/20 | The exact event ordering is now a required regression case. |
| Checklist completeness & order | 19/20 | Test-first ordering and runtime gates remain intact. |

### Why not 100%
- The child/stdout/stderr mock seam must be proven in the existing Vitest harness, and live recovery cannot be certified while the run is down.

### Blockers (human required?)
- No documentation blocker. Do not recover the stale lock or restart bulk as part of this guide; that is a separate operator action.

## Solidify pass 8 (2026-07-10 21:19)

### Findings
- [cross-guide conflict]: The prior 04.3 contract allowed generic auth-class FAIL cooldown, conflicting with the deliberately narrower 04.4 MVP.
- [classification]: `gapReasonFromError()` alone does not guarantee recognition of a terminal `PtsAuthError`; its structured reason must take precedence in the TypeScript worker.
- [configuration]: The durable event path was part of the design but absent from the proposed environment contract.

### Artifact sections touched
- `Problem statement (REL-08)`
- `🏗️ Architectural pattern`
- `Proposed env vars`
- `📋 Implementation checklist`

### Changes made
- Aligned storm timing with the runtime observations and constrained 04.4 to intentional exit-0 incomplete outcomes.
- Added the explicit worker `PtsAuthError` classification rule and an orchestrator-local canonical auth-gap predicate.
- Added the JSONL event-path environment variable.

### Verification evidence
- `src/captureGaps.ts` defines canonical `auth` and `subscription-expired` reasons.
- `src/ptsAuth.ts` exposes `PtsAuthError` with a structured reason; `src/wiring/saveConnector.ts` throws it after consecutive auth failures.
- `lib/bulk-orchestrator-lib.js` is CommonJS and does not consume TypeScript-only helper exports directly.

### Readiness score: 95/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Step executability | 19/20 | Classification and state flow are explicit. |
| Path / symbol verification | 19/20 | Source contracts are verified; planned test seam remains. |
| Risk & blast radius per step | 19/20 | Generic FAIL-policy expansion is explicitly excluded. |
| Test & verification plan | 19/20 | New predicates and terminal error behavior need focused tests. |
| Checklist completeness & order | 19/20 | Env, docs, rollback, and gates are aligned. |

### Why not 100%
- The newly discovered orchestrator stream-crash regression and its mocked-child test must be validated in the actual Vitest harness before formal certification.

## Solidify pass 9 (2026-07-10 21:30)

### Sections touched
- Implementation gate (operator recovery vs code)
- 04.3 vs 04.4 FAIL-path boundary
- Pre-Phase 0 operator recovery checklist
- Atomic write pattern for cooldown file
- Blast radius (FAIL-path limitation)
- Status footer

### Changes made
- Added explicit boundary: 04.3 does not cooldown fast auth-class FAIL exits.
- Added operator recovery checklist for already-stopped bulk (locks, reconcile, health).
- Clarified atomic-write expectation for `vehicle-cooldown.json`.
- Marked plan ready for user plan-package approval (not implementation-approved).

### Verification evidence
- Evening crash log shows FAIL-path loop before stream crash.
- Guide checklist already specifies mocked-stream regression test in Step 1.

### Readiness score: 96/100

### Why not 100%
- Formal `solidify-readiness-report.md` for the guide artifact is still missing.
- Mocked child-stream test seam should be confirmed in `test/bulk-orchestrator.test.ts` during Phase 0.

### Blockers (human required?)
- User plan-package approval.

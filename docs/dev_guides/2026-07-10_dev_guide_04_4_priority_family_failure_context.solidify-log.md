# Context solidification log — Guide 04.4 candidate

## Initialization (2026-07-10)

- Artifact initialized from Draft to Refining at pass 0.
- Scope: worker-level bounded handling of partial auth failures and dependent scheduler recovery policy.
- Explicit non-goals: no active-bulk code changes, no claim that external 403s prove subscription expiration, no global queue-rank rewrite, no second scheduler.

## Solidify pass 1 (2026-07-10 11:21)

### Findings
- [scope ambiguity]: The original draft named a separate 04.4 policy but did not make the interface boundary with 04.3 explicit enough to prevent duplicate cooldown state.
- [acceptance ambiguity]: The worker, scheduler, and external-service responsibilities needed clearer separation.

### Artifact sections touched
- Work item overview

### Changes made
- Added explicit in-scope/out-of-scope constraints.
- Defined 04.3 as the owner of reusable cooldown/auth-evidence state and 04.4 as its dependent worker/partial-failure extension.

### Readiness score: 86/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 18/20 | Scope and non-goals explicit; final recovery contract awaits 04.3 design. |
| Pattern / reuse verified | 17/20 | Existing worker, queue, circuit-breaker, and gap paths verified. |
| Risk & blast radius | 18/20 | Main runtime and active-bulk risks described. |
| Acceptance criteria draftable | 18/20 | Behavioral criteria are testable but recovery-generation semantics need a decision. |
| Knowledge gaps resolved | 15/20 | External 403 cause intentionally unresolved; controlled retry evidence remains pending. |

### Blockers (human required?)
- None. The unresolved external 403 cause is not a blocker because the design will act on observed failure class and verified recovery, not provider-internal diagnosis.

## Solidify pass 2 (2026-07-10 11:21)

### Findings
- [evidence gap]: E-Series and connector-only Explorer evidence needed direct verification rather than inference from the broader cluster.
- [scope refinement]: The analysis needed to distinguish the Explorer connector auth redirect that 04.3 directly addresses from the expensive workshop partial-failure behavior reserved for 04.4.

### Artifact sections touched
- Evidence-based classification

### Changes made
- Added verified E-Series 403 evidence and the distinct Explorer connector-only auth redirect evidence.
- Stated the direct 04.3 coverage of connector-only stale-session failures versus the 04.4 worker-level workshop short-circuit.

### Readiness score: 92/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 19/20 | Responsibilities now separated by failure path. |
| Pattern / reuse verified | 18/20 | Worker, scheduler, gap, and circuit breaker paths are verified. |
| Risk & blast radius | 19/20 | Risks include recovery false positives and partial-data preservation. |
| Acceptance criteria draftable | 19/20 | Criteria can become behavioral tests after the 04.3 contract is fixed. |
| Knowledge gaps resolved | 17/20 | Provider-internal 403 cause and controlled post-refresh reproduction remain intentionally open. |

### Blockers (human required?)
- None. The remaining gaps are Phase 0 verification requirements, not unanswerable design decisions.

## Solidify pass 3 (2026-07-10 11:27)

### Findings
- [missing failure mode]: The draft did not distinguish zero-PDF auth failures, which are stranded in `failed`, from partial `failed` jobs, which can re-run wastefully.
- [missing boundary]: Wiring-TOC 403s could exit without a structured gap, making the scheduler unable to distinguish a retryable auth partial from an opaque worker error.

### Artifact sections touched
- Scope boundaries
- Acceptance criteria
- Evidence-based classification
- Verified root-cause chain
- Related work and correct guide boundaries

### Changes made
- Added recovery criteria for zero-PDF verified-auth failures.
- Added structured wiring-TOC gap/outcome handling to 04.4 scope.
- Clarified that 04.4 extends cooldown to auth-bearing FAIL paths, while 04.3 remains constrained to REL-08 INCOMPLETE behavior.

### Verification evidence
- `scripts/queue-lib.js:isQueued()` gates `failed` retries on `pdfCount >= 50`.
- `lib/bulk-orchestrator-lib.js:552–585` maps nonzero partial runs to `failed`.
- Runtime investigation confirmed the distinction across E-Series/F-450 early failures and Navigator/Explorer/F-550 partial rerun storms.

### Readiness score: 94/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 19/20 | Three auth failure classes are separated with explicit ownership. |
| Pattern / reuse verified | 19/20 | Existing queue, worker, circuit, and gap patterns are cited and verified. |
| Risk & blast radius | 19/20 | Exit semantics and recovery safeguards are explicit. |
| Acceptance criteria draftable | 19/20 | Criteria map to worker, queue, and integration tests. |
| Knowledge gaps resolved | 18/20 | Controlled post-refresh retry and final 04.3 interface remain pending. |

### Blockers (human required?)
- No business blocker. Do not mark Ready or author the implementation guide until Guide 04.3’s cooldown/evidence interface is finalized and controlled retry evidence is captured after bulk stops.

## Solidify pass 4 (2026-07-10 11:37)

### Findings
- [readiness inflation]: The prior 94/100 score overstated readiness despite a missing formal dev guide, an unfrozen 04.3 interface, unchosen worker exit semantics, and unrun controlled reproduction.
- [queue mechanism]: Partial `failed` rows rank ahead of `pending`, while zero-PDF failures are only recoverable through later reconcile; these distinct behaviors needed explicit scope.
- [taxonomy drift]: The draft proposed a new `cdp` reason that does not exist in the current canonical gap-reason contract.

### Artifact sections touched
- Work item overview
- Acceptance criteria
- Verified root-cause chain
- Related work and correct guide boundaries
- Architecture proposal
- Infrastructure and knowledge status
- Readiness assessment

### Changes made
- Reduced readiness to 80/100 and stated that a 04.4 dev guide must not be authored until the 04.3 interface and reproduction results are available.
- Chose the proposed auth-budget stop contract for later validation: persist blocking gaps, emit a marker, and exit 0 to reuse the existing `incomplete` status path.
- Added failed-rank preemption, min-attempt stale-gap blind spot, and existing-reason taxonomy constraints.

### Verification evidence
- `scripts/queue-lib.js` ranks `failed` at 10 and `pending` at 20; it gates failed eligibility on 50 PDFs.
- `lib/bulk-orchestrator-lib.js:resolveFinalVehicleStatus` maps nonzero partial runs to `failed`.
- `src/captureGaps.ts:gapReasonFromError` defines the actual reason vocabulary.

### Readiness score: 80/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 17/20 | Scope is clear, but the worker-stop behavior remains a Phase 0 validation decision. |
| Pattern / reuse verified | 17/20 | Existing queues, gaps, and circuit mechanisms are verified; 04.3 interface is pending. |
| Risk & blast radius | 17/20 | Key exit/queue risks documented; no controlled reproduction yet. |
| Acceptance criteria draftable | 15/20 | Testable after the four-case reproduction matrix locks behavior. |
| Knowledge gaps resolved | 14/20 | Shared contract and runtime evidence are material prerequisites. |

### Blockers (human required?)
- Technical readiness blocker, not a user-choice blocker: complete 04.3 first, then collect the defined controlled reproduction evidence before authoring the 04.4 dev guide.

## Solidify pass 5 (2026-07-10 11:56)

### Findings
- [overengineering]: A proposed recovery-generation state was not needed once 04.3 defined verified connector-content preflight as the cooldown-clear signal.
- [scope]: Generic auth-bearing FAIL cooldown would overlap with 04.3 and widen scheduler behavior. The two verified 04.4 paths can instead become intentional `incomplete` outcomes with structured gaps.
- [gap]: The reproduction list lacked exact setup and observable outcomes, leaving status semantics and early zero-PDF recovery untestable.

### Artifact sections touched
- `Acceptance criteria`
- `Verified root-cause chain`
- `Related work and correct guide boundaries`
- `Architecture proposal`
- `Infrastructure and knowledge status`
- `Readiness assessment`

### Changes made
- Removed recovery-generation state and generic FAIL-path cooldown from the 04.4 MVP; retained the single 04.3 cooldown mechanism.
- Proposed stable TreeAndCover and wiring-TOC gap contracts that reuse existing capture-gap section types and route intentional auth stops to `incomplete`.
- Added a four-case controlled reproduction matrix and explicit worker-budget/`PtsAuthError` boundaries.

### Verification evidence
- `src/captureGaps.ts` permits `workshop` and `wiring-page` gaps and persists/retries by stable `id`.
- `src/index.ts` currently lets TreeAndCover and wiring-TOC errors reach the top-level exit handler; normal completion exits 0 and `PtsAuthError` exits 2.
- `lib/bulk-orchestrator-lib.js:resolveFinalVehicleStatus` classifies exit 0 plus blocking gaps as `incomplete`.
- `scripts/queue-lib.js` queues all `incomplete` rows but gates `failed` rows at 50 PDFs.

### Readiness score: 86/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 18/20 | MVP boundary is tighter and avoids a competing scheduler policy. |
| Pattern / reuse verified | 18/20 | Existing gaps, status resolution, and cooldown boundary are now explicitly reused. |
| Risk & blast radius | 17/20 | Exit conversion needs real controlled evidence before code. |
| Acceptance criteria draftable | 17/20 | Matrix is testable; the auth-budget threshold remains intentionally unchosen. |
| Knowledge gaps resolved | 16/20 | 04.3 production interface and four runtime cases are outstanding prerequisites. |

### Blockers (human required?)
- No business blocker. Technical prerequisites remain: execute and soak 04.3, then run the four-case reproduction matrix before authoring an implementation guide.

## Solidify pass 6 (2026-07-10 12:00)

### Findings
- [evidence correction]: The current partial backlog is not a wiring-TOC gap cluster. All 3,441 active blocking gaps are workshop auth 403s; wiring-TOC remains a verified code-path risk to reproduce.
- [operational value]: Partial progress is materially larger than the completion count alone suggests: 14 rows contain about 15.9k reusable PDFs, while all 36 failed rows are empty and separate.
- [integrity]: No queue/disk status mismatch exists, so reconciliation or a global status rewrite would add risk without recovering work.

### Artifact sections touched
- `Evidence-based classification`
- `Runtime snapshot — 2026-07-10 11:47 local`

### Changes made
- Corrected the wiring-TOC evidence claim and retained it as a controlled-reproduction path rather than an asserted current cause.
- Added the quantified live snapshot, artifact coverage, and queue/disk integrity result.
- Narrowed the stated 04.4 motivation to the current workshop-auth backlog plus the two unstructured early-failure code paths.

### Verification evidence
- Read-only queue/artifact audit: 12 incomplete rows, 2 active rows, 36 zero-PDF failed rows, and no `verifyDownload()` status mismatch.
- Current incomplete `capture-gaps.json` files: all blocking records are `section: workshop`, `reason: auth`.
- `src/index.ts` retains unstructured TreeAndCover and wiring-TOC error propagation; `src/wiring/fetchTableOfContents.ts` does not record a gap.

### Readiness score: 88/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 19/20 | Current-backlog evidence and deferred code-path risks are explicitly separated. |
| Pattern / reuse verified | 19/20 | Existing queue, gaps, and 04.3 cooldown boundaries are verified. |
| Risk & blast radius | 18/20 | Controlled reproduction is still required before changing exit behavior. |
| Acceptance criteria draftable | 17/20 | The matrix is concrete, but the auth-budget threshold is intentionally pending evidence. |
| Knowledge gaps resolved | 15/20 | 04.3 soak and the four live cases are material prerequisites. |

### Blockers (human required?)
- No business blocker. The 04.4 context is stronger but remains below authoring/implementation readiness until 04.3 has been implemented and the controlled reproduction matrix is complete.

## Solidify pass 7 (2026-07-10 12:23)

### Findings
- [operator clarity]: The context phrased active bulk as a blocker for all further planning, even though the repository rules permit documentation-only evidence gathering.
- [sequencing]: The actual 04.4 blocker is dependency evidence—executed/soaked 04.3 and controlled reproduction—not a need to pause a healthy run merely to review documents.

### Artifact sections touched
- `Context summary header`
- `Readiness assessment`

### Changes made
- Distinguished safe live-run documentation work from prohibited runtime-changing work.
- Restated the correct sequence: validate 04.3 documents now; deploy/soak 04.3 later; then run the 04.4 reproduction matrix during a planned stop.

### Verification evidence
- `AGENTS.md` requires no source change or bulk restart during active bulk but permits documentation/evidence work.
- The 04.4 dependency remains architectural: it reuses the 04.3 cooldown contract and requires its production behavior before its own guide can be finalized.

### Readiness score: 88/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 19/20 | Scope and dependency boundary are clear. |
| Pattern / reuse verified | 19/20 | Existing gaps, queue states, and 04.3 contract are documented. |
| Risk & blast radius | 18/20 | Runtime exit conversion still requires controlled reproduction. |
| Acceptance criteria draftable | 17/20 | Matrix is concrete; threshold evidence is pending. |
| Knowledge gaps resolved | 15/20 | 04.3 soak and four runtime cases remain material prerequisites. |

### Blockers (human required?)
- None for documentation work. 04.4 implementation remains technically blocked until 04.3 is deployed/soaked and the controlled reproduction matrix is complete.

## Solidify pass 8 (2026-07-10 21:19)

### Findings
- [cross-guide accuracy]: The context implied 04.3 directly excluded generic partial `failed` rows, but its contract is fast auth `incomplete` only.
- [testability]: Proposed early-failure IDs were readable but not tied to the actual helper calls and source of the wiring book value.
- [queue context]: The present incomplete backlog is already stale; a global rank change would not address the principal future in-worker waste.

### Artifact sections touched
- `Acceptance criteria`
- `Phase 0 decisions and verification required before a dev guide`

### Changes made
- Reworded failed-row behavior as intentional gap persistence plus exit-0 incomplete before shared cooldown.
- Bound the proposed TreeAndCover and wiring-TOC IDs to canonical helper calls.
- Added the stale-backlog versus future in-worker-waste distinction.

### Verification evidence
- `scripts/queue-lib.js` gives `failed` rank 10 but queues `incomplete` unconditionally; the 04.3 contract is fast auth incomplete only.
- `src/captureGaps.ts` provides `workshopGapId` and `wiringPageGapId`; `src/index.ts` derives `wiringParams.book` from the workshop wiring book code.
- Current partial audit shows all 12 incomplete rows at or above the stale attempt threshold.

### Readiness score: 88/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 19/20 | Cross-guide outcome is now precise. |
| Pattern / reuse verified | 19/20 | IDs and queue paths map to current code. |
| Risk & blast radius | 18/20 | Controlled exit changes still require runtime proof. |
| Acceptance criteria draftable | 17/20 | Threshold and exact stop implementation remain post-04.3 decisions. |
| Knowledge gaps resolved | 15/20 | 04.3 soak and four runtime cases remain prerequisites. |

### Blockers (human required?)
- None for documentation work. 04.4 remains blocked from authoring and implementation until 04.3 is deployed/soaked and the reproduction matrix completes.

## Solidify pass 9 (2026-07-10 21:20)

### Findings
- [security]: Live `2014-fiesta.log` evidence shows raw Axios errors from workshop ignored-error paths can serialize session cookies.
- [reuse]: `src/logHttpError.ts` already has the correct sanitized Axios summary; the leak is a caller-path inconsistency, not a need for a new logging framework.
- [readiness]: This adds a bounded, testable 04.4 requirement but makes the context less ready until its worker-path behavior is validated.

### Artifact sections touched
- `Scope boundaries`
- `Acceptance criteria`
- `Verified root-cause chain`
- `Blast radius and risks`

### Changes made
- Added sanitized worker error logging to 04.4 scope and acceptance criteria.
- Defined reuse of `logHttpError()` rather than logging raw caught errors.
- Recorded handling requirements for existing sensitive logs.

### Verification evidence
- `src/logHttpError.ts` intentionally omits Axios config, cookies, and sockets.
- `src/workshop/saveEntireManual.ts` logs raw caught error objects in ignored-error branches.
- The 2026-07-10 `2014-fiesta.log` contains session-cookie-bearing Axios error output.

### Readiness score: 86/100

### Score breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements & scope clarity | 19/20 | The security outcome and narrow reuse path are explicit. |
| Pattern / reuse verified | 19/20 | Existing sanitizer is source-verified. |
| Risk & blast radius | 17/20 | Worker logging change must preserve operational diagnostics. |
| Acceptance criteria draftable | 17/20 | Requires a fixture that proves headers/config are absent. |
| Knowledge gaps resolved | 14/20 | 04.3 soak, runtime matrix, and redaction test remain prerequisites. |

### Blockers (human required?)
- No documentation blocker. 04.4 remains dependent on 04.3, controlled reproduction, and a formal dev guide; existing affected logs should be handled as sensitive operational artifacts.

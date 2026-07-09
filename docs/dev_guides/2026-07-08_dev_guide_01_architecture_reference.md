# Dev Guide 01: Architecture Reference

## 🎯 Objective

Establish canonical architecture, queue contracts, and operator doc hierarchy so Dev Guide 02+ can implement tests and refactors without ambiguous semantics.

## 📚 Critical Context & References

> **CRITICAL:** Read these before any foundation code changes.

* **Strategy source:** `docs/2026-07-08_codebase_foundation_context_assessment.md` (Pass 4 — final)
* **Work session standards:** `second_brain/docs/guides/prompt_work_session_standards.md`
* **Context gathering:** `second_brain/docs/guides/meta_context_gathering.md`
* **Dev guide standards:** `second_brain/docs/guides/meta_creating_dev_guides.md`
* **Execution workflow (Guide 02+):** `second_brain/docs/guides/prompt_follow_dev_guide.md`
* **Agent invariants:** `AGENTS.md`
* **Operator index:** `docs/PIPELINE_OPS.md`

**Note:** `PIPELINE_OPS.md` in *this* repo is the Ford bulk operator index. It is unrelated to `simple_content_platform/docs/PIPELINE_OPS.md`.

## 🏗️ Architectural Pattern

> **Pattern:** Single canonical reference + thin operator summaries  
> **Flow:** `docs/reference/*` (truth) → `PIPELINE_OPS.md` / `pipeline-scheduling.md` / `BULK_DOWNLOAD_GUIDE.md` (operators) → `AGENTS.md` (agent invariants)  
> **Constraint:** No fifth parallel architecture doc. Link, do not copy lock/status prose.

```
docs/reference/architecture.md     ← canonical
docs/reference/schemas.md          ← gap blocking truth (JS semantics)
docs/reference/queue_state_machine.md
docs/reference/env_vars.md
```

## 📋 Implementation Checklist

> **Status:** Guide 01 was **executed** (reference outputs below). Guides 02–06 are **plans only** — do not implement until Tom approves each guide.

### Step 1: Create reference docs

* [x] `docs/reference/README.md` — index
* [x] `docs/reference/architecture.md` — system diagram, layers, locks, blessed commands
* [x] `docs/reference/queue_state_machine.md` — statuses, transitions, write semantics
* [x] `docs/reference/schemas.md` — vehicles.json, capture-gaps, **canonical blocking matrix**
* [x] `docs/reference/env_vars.md` — env catalog

### Step 2: Operator doc alignment

* [x] Create `docs/PIPELINE_OPS.md` — operator index (links to reference)
* [x] Update `docs/pipeline-scheduling.md` — CDP lock scope (per-connector + capture yield/defer)
* [x] Update `BULK_DOWNLOAD_GUIDE.md` — fleet size ~295, link to reference
* [x] Update `docs/2026-07-08_pipeline_inventory_and_action_items.md` — CDP section + foundation status
* [x] Update `AGENTS.md` — link to `docs/reference/` (keep invariants short)

### Step 3: Cross-link verification

* [x] Every blessed command in `AGENTS.md` appears in `architecture.md`
* [x] Gap blocking in `schemas.md` matches `scripts/capture-gaps-lib.js` (not `captureGaps.ts` until Guide 02)
* [x] CDP lock behavior matches `src/cdpConnectorPage.ts` and `scripts/capture-params.ts`

### Step 4: Dev Guide 02 prerequisites (document only)

* [x] Fixture shapes specified in `schemas.md`
* [ ] Actual `test/fixtures/` files — **Dev Guide 02** (plan authored; not implemented)

## ✅ Verification & Definition of Done

* [x] **Manual:** Open `docs/reference/architecture.md` — diagram covers bulk, capture, CDP, state stores
* [x] **Manual:** `schemas.md` blocking matrix matches `capture-gaps-lib.js` `isBlockingGap()`
* [x] **Manual:** `pipeline-scheduling.md` CDP section no longer implies session-long capture lock only
* [x] **Manual:** `BULK_DOWNLOAD_GUIDE.md` fleet size reflects 186 + 109 expansion
* [x] **Manual:** `AGENTS.md` links to reference without duplicating full lock prose
* [ ] **Tom review:** Approve canonical blocking rules before Dev Guide 02 starts
* [ ] **Code Review:** N/A — docs-only guide

## ⚠️ Blast Radius & Risks

| Risk | Mitigation |
|------|------------|
| Doc drift vs code | Reference cites specific modules; Guide 02 adds tests |
| Wrong canonical gap rules | `schemas.md` explicitly follows JS lib; TS drift documented |
| Operator confusion | `PIPELINE_OPS.md` single entry point |
| Active bulk disrupted | **This guide is docs-only** — no bulk restart required |

**Rollback:** Revert markdown commits only.

## Next guides (plans only — see `docs/dev_guides/README.md`)

| Guide | Status |
|-------|--------|
| 02 Test harness + libs | Plan authored — **blocked until Tom approves `schemas.md` blocking matrix** |
| 03 CDP coordination tests | Plan authored |
| 04 Orchestrator split | Plan authored — **bulk must be stopped** |
| 05 Capture modularization | Plan authored |
| 06 Pre-2003 capture | Plan authored |

---

**Executed:** 2026-07-08 (reference docs delivered)  
**Changelog:** Clarified Guide 01 = executed; 02–06 = plans only

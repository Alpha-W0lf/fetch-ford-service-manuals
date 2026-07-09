# Dev Guide 06: Pre-2003 Capture Automation

## 🎯 Objective

Automate `params.json` capture for `modelYear < 2003` vehicles so the fleet does not depend on manual DevTools — producing a **real** `pre_2003.alphabeticalIndexURL` and wiring fields, then reusing the existing `src/pre-2003/` download path in `yarn start`.

## 📚 Critical Context & References

> **CRITICAL:** Read before implementation.

* **Policy:** `docs/2026-07-08_pipeline_inventory_and_action_items.md` § Pre-2003 automation
* **Runtime context:** `docs/2026-07-08_pipeline_runtime_observations.md` — defer legacy until modern `needs_params` drained
* **Modern capture (must complete first):** Dev Guide 05 → `src/capture/`
* **Current monolith behavior:** `scripts/capture-params.ts` lines 681–688 defer `<2003`; `--include-legacy` only **includes** them in target list — **no legacy navigation**
* **Placeholder trap:** `buildParams()` sets `pre_2003.alphabeticalIndexURL` to `https://www.fordservicecontent.com/pubs/content/.....` — `src/index.ts` and `src/readConfig.ts` **reject** this at download time
* **Download path (already exists):** `src/pre-2003/fetchAlphabeticalIndex.ts`, `saveEntirePre2003AlphabeticalIndex.ts`; `src/index.ts` branches when `modelYear < 2003`
* **Upstream manual flow:** `README.md` § "2002 or older: Get data for your car"
* **Schemas:** `docs/reference/schemas.md` — `pre_2003` section
* **Exploration gate:** `docs/reference/legacy_pts_capture.md` — **must be filled by operator** before code (PTS UI differs from 2003+)

**Gate:** Dev Guide **05 executed** + `legacy_pts_capture.md` exploration **complete** + capture **stopped** for implementation.

**Subscription window:** Default **defer** — only 3 legacy vehicles; ~47+ modern `needs_params` remain. Implement after modern queue drained or explicit operator override.

## 🏗️ Architectural Pattern

> **Pattern:** Year branch in modular capture pipeline  
> **Flow:** `modelYear < 2003` → legacy PTS navigation → copy Alphabetical Index URL → wiring intercept → write `params.json` → `patch-queue` pending → `yarn start` uses `pre-2003/`  
> **Constraint:** Do not break 2003+ `captureParams()` path; legacy is a **parallel branch** in `captureFlow.ts` or `legacyCapture.ts`.

### Modern vs legacy (behavioral split)

| Step | 2003+ (today) | `< 2003` (Guide 06) |
|------|---------------|---------------------|
| Vehicle ID | Year/model tab → example VIN → commit | **TBD in exploration** — likely Workshop tab → pick manual |
| Workshop params | Network intercept `TreeAndCover/workshop` POST | Minimal `workshop.modelYear` + **`pre_2003.alphabeticalIndexURL`** (real URL) |
| Wiring params | Intercept `TableofContent` GET | **Same intercept** as modern (README § All Vehicles) |
| Download | `modernWorkshop` + wiring + connectors | `pre2003Workshop` (alphabetical index HTML→PDF) + wiring |

### Queue targets (verified 2026-07-08)

| id | year | ptsModel | status |
|----|------|----------|--------|
| `2000-excursion` | 2000 | Excursion | `needs_params` |
| `2001-excursion` | 2001 | Excursion | `needs_params` |
| `2002-excursion` | 2002 | Excursion | `needs_params` |

### Proposed modules (after Guide 05)

```
src/capture/
  legacyCapture.ts          # orchestrate legacy vehicle capture (entry from runCaptureSession)
  legacyNavigation.ts       # PTS UI: Workshop → manual → Alphabetical Index link
  legacyUrlValidation.ts      # pure: reject placeholder, validate fordservicecontent URL shape
  networkIntercept.ts         # reuse wiring intercept (shared)
  buildParams.ts              # split: modern vs legacy param shapes
test/
  legacyUrlValidation.test.ts
  legacyCapture.test.ts       # year branch selection only (no Playwright)
```

### Placeholder constants (must match code)

```typescript
// scripts/capture-params.ts buildParams + templates/params.json.template
const PLACEHOLDER_PRE2003_URL =
  "https://www.fordservicecontent.com/pubs/content/.....";
```

`isValidLegacyAlphabeticalUrl(url)` must return **false** for placeholder and **true** for URLs matching exploration doc patterns.

## 📋 Implementation Checklist

### Step 0: Preflight — HARD GATE

* [ ] Dev Guide **05 executed** (`src/capture/` modular)
* [ ] **`docs/reference/legacy_pts_capture.md` completed** (operator PTS session — not AI speculation)
* [ ] Capture **stopped** for implementation
* [ ] `yarn test` green
* [ ] Confirm 3 legacy vehicles still `needs_params` in `templates/vehicles.json`

### Step 1: Exploration doc (operator — blocks code)

* [ ] Fill `docs/reference/legacy_pts_capture.md` for **one** vehicle (recommend `2002-excursion`)
* [ ] Document: login state, Workshop tab flow, manual selection UI, Alphabetical Index link pattern
* [ ] Capture example real `alphabeticalIndexURL` (redact cookies; URL shape is OK in doc)
* [ ] Note differences from 2003+ Vehicle ID iframe flow
* [ ] Screenshots optional → `docs/reference/img/legacy-*.png` if added

### Step 2: Pure validation + routing (tests first)

* [ ] `legacyUrlValidation.ts` — `isLegacyVehicle(year)`, `isValidAlphabeticalIndexUrl(url)`, `isPlaceholderPre2003Url(url)`
* [ ] `test/legacyUrlValidation.test.ts` — table tests for placeholder, valid fordservicecontent URLs, invalid hosts
* [ ] `captureFlow.ts` or `runCaptureSession` — branch on `vehicle.modelYear < 2003` when `includeLegacy` or dedicated flag

### Step 3: Legacy navigation (Playwright — manual smoke per commit)

* [ ] `legacyNavigation.ts` — implement steps from `legacy_pts_capture.md`
* [ ] Extract Alphabetical Index `href` (equivalent to README "Copy Link Address")
* [ ] Reuse `createCaptureState` / wiring intercept for Wiring tab (same as modern)
* [ ] `buildLegacyParams(year, ptsModel, alphabeticalUrl, workshop, wiring)` — **no placeholder** in output

### Step 4: Integrate CLI (`src/capture/cli.ts`)

* [ ] `--include-legacy` — include `<2003` in targets **and** run legacy branch (not filter-only)
* [ ] Optional: `--legacy-only` — only `modelYear < 2003` (for focused soak)
* [ ] Default sort unchanged: modern first; legacy only when included
* [ ] `patch-queue` → `pending` on success (via `lib/patch-queue.js`)
* [ ] Log prefix `[legacy]` for traceability

### Step 5: Download validation (operator soak)

* [ ] `yarn start` on **one** captured legacy vehicle (`2002-excursion` recommended)
* [ ] Confirm `pre_2003.alphabeticalIndexURL` accepted (not placeholder error)
* [ ] Confirm PDFs under output dir (alphabetical index pages)
* [ ] Wiring + connectors per vehicle config (Excursion may need full wiring like modern)

### Step 6: Tests + docs

* [ ] Fixture `test/fixtures/legacy-params.json` — valid shape
* [ ] Update `docs/reference/schemas.md` — legacy capture automated
* [ ] Update `queue_state_machine.md` — legacy path writer
* [ ] Update `BULK_DOWNLOAD_GUIDE.md` / inventory — remove "manual DevTools only" for automated class
* [ ] `yarn test && yarn typecheck` green

## ✅ Verification & Definition of Done

* [ ] At least one pre-2003 vehicle: `needs_params` → `pending` → `yarn start` completes workshop pre-2003 phase
* [ ] `pre_2003.alphabeticalIndexURL` is real URL on disk in `vehicles/<id>/params.json`
* [ ] No manual DevTools required for Excursion-class vehicles in queue
* [ ] 2003+ capture regression: `yarn capture-params --limit 1` on modern vehicle still OK
* [ ] `yarn test` green

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wrong alphabetical URL → empty/broken PDFs | **High** | URL validation + one-vehicle soak before fleet |
| PTS legacy UI differs per model/year | **High** | Exploration doc per manual type; start with Excursion only |
| Breaking 2003+ capture | **High** | Separate branch; Guide 05 module tests; modern smoke after merge |
| Subscription time on 3 low-priority vehicles | Low | Default defer; `--legacy-only` for explicit runs |
| Legacy uses CDP while bulk connectors run | Medium | Same lock/defer as modern capture |

**Rollback:** Revert; legacy vehicles stay `needs_params`; modern capture unaffected.

**Safe during active bulk:** Yes (bulk continues; **capture restart** required after deploy).

**Safe during active capture:** **NO**.

**Safe during subscription crunch:** **Defer implementation** — 3 vehicles vs ~47 modern `needs_params`.

---

## Strangler order (mandatory)

1. Operator completes `legacy_pts_capture.md` (no code)
2. `legacyUrlValidation` + tests
3. `buildLegacyParams` + fixture test
4. `legacyNavigation.ts` (smoke one vehicle manually)
5. Wire into `runCaptureSession` / `legacyCapture.ts`
6. CLI flags + logging
7. Full soak: capture → `yarn start` → verify PDFs
8. Docs

---

## Open questions (resolve in exploration doc, not in code guesses)

1. Does legacy flow use Vehicle ID iframe at all, or Workshop-only entry?
2. Multiple manuals (Workshop vs Body Collision) — capture one or all?
3. Are Excursion years 2000–2002 identical PTS navigation?
4. Do legacy vehicles need connector capture (`wiring` + CDP) or workshop+wiring only?

---

**Status:** Plan only — **not implementation-ready** until `legacy_pts_capture.md` is operator-filled  
**Depends on:** Dev Guide 05 (**not executed**), exploration doc  
**Blocks:** None (fleet can run without legacy)  
**After this guide:** **No numbered Dev Guide 07** — Phase G (pre-commit, watchdog, orchestrator heartbeat) is a **future** ops hardening track

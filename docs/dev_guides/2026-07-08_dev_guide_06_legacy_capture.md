# Dev Guide 06: Pre-2003 Capture Automation

## 🎯 Objective

Automate `params.json` capture for `modelYear < 2003` vehicles so the fleet does not depend on manual DevTools — reusing `src/pre-2003/` download path after params are valid.

## 📚 Critical Context & References

* **Policy:** `docs/2026-07-08_pipeline_inventory_and_action_items.md` (Pre-2003 automation backlog)
* **Current:** `capture-params.ts` defers `<2003`; `--include-legacy` filters queue only
* **Download path:** `src/pre-2003/`, `src/index.ts` branch
* **Modular capture:** Dev Guide 05 (`src/capture/`)

## 🏗️ Architectural Pattern

> **Pattern:** Year branch in capture pipeline  
> **Flow:** `modelYear < 2003` → Workshop manual selection → real `pre_2003.alphabeticalIndexURL` + wiring intercept → `params.json` → `yarn start`  
> **Constraint:** Defer until modern `needs_params` queue drained unless operator overrides.

## 📋 Implementation Checklist

### Step 0: Preflight

* [ ] Dev Guide 05 complete (modular capture)
* [ ] Identify pre-2003 vehicles in queue (≈3 today: years 2000–2002)
* [ ] Manual PTS exploration: document UI steps for one legacy vehicle (screenshots/notes in `docs/reference/legacy_pts_capture.md`)

### Step 1: Legacy navigation module

* [ ] `src/capture/legacyNavigation.ts` — select manual, capture alphabetical index URL
* [ ] Network intercept for wiring (reuse existing intercept helpers)
* [ ] Validate captured `pre_2003.alphabeticalIndexURL` is HTTP(S) PTS URL, not placeholder

### Step 2: Integrate CLI

* [ ] `--include-legacy` enables capture branch (not just queue filter)
* [ ] Sort order: modern first unless `--legacy-only` flag (optional)
* [ ] `patch-queue.js` → `pending` on success

### Step 3: Download validation

* [ ] `yarn start` on one captured legacy vehicle (manual soak)
* [ ] Compare PDF count / structure to known-good if available

### Step 4: Tests

* [ ] Unit tests for URL validation, year branch selection (no live PTS)
* [ ] Fixture params.json for legacy shape in `test/fixtures/`

### Step 5: Documentation

* [ ] Update `schemas.md` params `pre_2003` section
* [ ] Update inventory doc — remove "manual DevTools" policy violation
* [ ] Update `BULK_DOWNLOAD_GUIDE.md` legacy section

## ✅ Verification & Definition of Done

* [ ] At least one pre-2003 vehicle: `needs_params` → `pending` → successful `yarn start`
* [ ] No manual DevTools required for that vehicle class
* [ ] `yarn test` green
* [ ] Architecture doc updated

## ⚠️ Blast Radius & Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wrong alphabetical URL | High | Validation + manual soak one vehicle |
| PTS UI differs from 2003+ | Medium | Dedicated legacy module; feature flag |
| Subscription time on low-value legacy | Low | Default defer; operator opt-in |

**Rollback:** Feature flag or revert; legacy vehicles return to `needs_params`.

**Safe during active bulk:** Capture restart required; bulk unaffected.

---

**Status:** Plan only — **not implemented**  
**Depends on:** Dev Guide 05  
**Post-guide:** Phase G hardening (pre-commit, watchdog) — separate future guide

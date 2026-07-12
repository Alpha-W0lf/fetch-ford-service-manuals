# Relationship — Vehicle library program & Mechanic RAG

**Date:** 2026-07-12  
**Status:** Pointer only (ops SSOT remains this repo’s `docs/reference/` + PIPELINE_OPS)

This repo owns **Ford PTS capture** (queue, params, bulk download, gaps). Capture for the current fleet is largely done; **processing / unification** into per-vehicle service, wiring, and connectors packages is **still pending**.

**Program hub (SSOT):**  
`second_brain/docs/2026-07-12_vehicle_docs_library_and_mechanic_rag_program.md`

**Also in that hub:**
- Dual use cases: **Google Drive PDF delivery** for Tom’s diesel-mechanic friend + **RAG packages** for Mechanic
- Multi-source future: other OEM/third-party **adapter repos** + shared catalog contract (do not fork inventory logic ad hoc)
- Backlog: `VEH-SRC-NEXT-001` next extraction source (**name/URL TBD** — do not build now)

**Consumer (RAG):** `mechainic_rag` — fixtures publicly; private Gold packages later.

Do not implement process/unify or Drive upload in a drive-by during active bulk unless Tom authorizes a dedicated stage.

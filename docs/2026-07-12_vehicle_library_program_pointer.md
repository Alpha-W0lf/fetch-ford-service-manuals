# Relationship — Vehicle library program & Mechanic RAG

**Date:** 2026-07-12  
**Status:** Pointer only (ops SSOT remains this repo’s `docs/reference/` + PIPELINE_OPS)

This repo owns **Ford PTS capture** (queue, params, bulk download, gaps). Capture for the current fleet is largely done; **processing / unification into per-vehicle service, wiring, and connectors packages is still pending**.

**Program hub (SSOT for cross-repo intent):**  
`second_brain/docs/2026-07-12_vehicle_docs_library_and_mechanic_rag_program.md`

**Consumer (RAG product, public fixtures):** `mechainic_rag` — does **not** run bulk capture.

**Design expectation:** Fleet and non-Ford sources will grow for years. Keep capture status (this repo’s queue state machine) distinct from future **process** and **RAG-index** status planes documented in the hub SSOT.

Do not implement process/unify in a casual drive-by during active bulk unless Tom authorizes a dedicated stage.

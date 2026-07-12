# Relationship — Vehicle library program & Mechanic RAG

**Date:** 2026-07-12  
**Status:** Pointer only (ops SSOT remains this repo’s `docs/reference/` + PIPELINE_OPS)

This repo owns **Ford PTS capture** (queue, params, bulk download, gaps). Capture is **not complete**: 2026-07-12 live health showed 129 complete, 144 pending, 14 incomplete, 7 needing params, and 1 skipped. **Processing / unification** into per-vehicle service, wiring, and connectors packages is also pending.

**Program hub (SSOT):**  
`second_brain/docs/2026-07-12_vehicle_docs_library_and_mechanic_rag_program.md`

**Also in that hub:**
- Dual use cases: **Google Drive PDF delivery** for Tom’s diesel-mechanic friend + **RAG packages** for Mechanic
- Multi-source future: other OEM/third-party **adapter repos** + shared catalog contract (do not fork inventory logic ad hoc)
- Backlog: `VEH-SRC-NEXT-001` = **LEMON Manuals** (<https://lemon-manuals.la/>), next private source; do not build in the current vision stage
- Public portfolio boundary is strict; private capture/process/Drive paths do not enforce legal/rights blocking

**Consumer (RAG):** `mechanic_rag` (display: Mechanic RAG; Python package `mecharag`) — fixtures publicly; private Gold document artifacts later.

Do not implement process/unify or Drive upload in a drive-by during active bulk unless Tom authorizes a dedicated stage.

**Supervision note:** Auto-restart is critical **after** subscription renewal. Watchdog fixed+reinstalled 2026-07-12. **Subscription currently inactive** — keep paused (`touch ~/Library/Logs/ford-bulk-watchdog.pause`); do not start bulk/capture until Tom renews and authorizes. Blessed manual start: `./scripts/start-bulk-in-terminal.sh`.

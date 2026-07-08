#!/usr/bin/env bash
# Remove obviously incomplete download folders (safe before re-download).
# Usage: ./scripts/clean-partial-download.sh <vehicle-id>
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VID="${1:?vehicle id}"
OUT=$(node -pe "const q=require('$ROOT/templates/vehicles.json'); q.vehicles.find(v=>v.id==='$VID')?.outputDir" 2>/dev/null || true)
[[ -z "$OUT" || "$OUT" == "undefined" ]] && { echo "Unknown vehicle: $VID"; exit 1; }
FULL="$ROOT/$OUT"
if [[ ! -d "$FULL" ]]; then exit 0; fi
if [[ -f "$FULL/Wiring/toc.json" ]]; then
  echo "Keeping partial download (has Wiring/toc.json): $FULL"
  exit 0
fi
PDFS=$(find "$FULL" -name '*.pdf' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$PDFS" -lt 50 ]]; then
  echo "Removing partial download ($PDFS PDFs): $FULL"
  rm -rf "$FULL"
fi

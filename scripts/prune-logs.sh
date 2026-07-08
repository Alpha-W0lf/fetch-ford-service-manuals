#!/usr/bin/env bash
# Reclaim disk from noisy bulk orchestrator logs and axios error dumps.
#
# Usage:
#   ./scripts/prune-logs.sh           # dry-run
#   ./scripts/prune-logs.sh --apply   # delete / trim
#
# Keeps: per-vehicle logs (trimmed), latest bulk-download log, START/OK/FAIL summaries.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

bytes_before=$(du -sk "$LOG_DIR" 2>/dev/null | awk '{print $1}')

echo "Log directory: $LOG_DIR ($(du -sh "$LOG_DIR" | awk '{print $1}'))"
echo "Mode: $( $APPLY && echo APPLY || echo dry-run )"
echo ""

# Drop superseded bulk orchestrator logs (multi-hundred-MB retry storms).
latest_bulk=""
if ls "$LOG_DIR"/bulk-download-*.log >/dev/null 2>&1; then
  latest_bulk=$(ls -t "$LOG_DIR"/bulk-download-*.log | head -1)
fi

for f in "$LOG_DIR"/bulk-download-*.log; do
  [[ -f "$f" ]] || continue
  [[ "$f" == "$latest_bulk" ]] && continue
  size=$(du -h "$f" | awk '{print $1}')
  echo "REMOVE old bulk log ($size): $(basename "$f")"
  $APPLY && rm -f "$f"
done

# Trim vehicle logs bloated by full axios object dumps (keep head + tail).
for f in "$LOG_DIR"/*.log; do
  [[ -f "$f" ]] || continue
  [[ "$(basename "$f")" == bulk-download-* ]] && continue

  lines=$(wc -l < "$f" | tr -d ' ')
  [[ "$lines" -lt 5000 ]] && continue

  if grep -q 'AxiosError\|Symbol(kSocket)' "$f" 2>/dev/null; then
    echo "TRIM axios dump log ($lines lines): $(basename "$f")"
    if $APPLY; then
      tmp="${f}.prune.tmp"
      { head -n 200 "$f"; echo ""; echo "... [pruned axios object dump] ..."; echo ""; tail -n 80 "$f"; } > "$tmp"
      mv "$tmp" "$f"
    fi
  fi
done

bytes_after=$(du -sk "$LOG_DIR" 2>/dev/null | awk '{print $1}')
saved=$((bytes_before - bytes_after))
echo ""
echo "Reclaimed: ~$((saved / 1024)) MB"

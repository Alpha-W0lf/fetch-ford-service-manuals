#!/usr/bin/env bash
# Show download queue progress.
# Usage: ./scripts/queue-status.sh [queue.json]
#        ./scripts/queue-status.sh --health
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--health" ]]; then
  exec "$ROOT/scripts/pipeline-health.sh"
fi

QUEUE="${1:-$ROOT/templates/vehicles.json}"

node - "$QUEUE" <<'NODE'
const fs = require("fs");
const path = require("path");

const queuePath = process.argv[2];
const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
const vehicles = q.vehicles || [];

const byStatus = {};
for (const v of vehicles) {
  byStatus[v.status] = (byStatus[v.status] || 0) + 1;
}

const tier1 = vehicles.filter((v) => v.tier === 1);
const tier1Complete = tier1.filter((v) => v.status === "complete").length;

console.log("Queue:", queuePath);
console.log("Parallel workers (default):", q.parallel ?? 1);
console.log("");
console.log("Status counts:");
for (const [s, n] of Object.entries(byStatus).sort()) {
  console.log(`  ${s}: ${n}`);
}
console.log("");
console.log(`Tier 1 breadth anchors: ${tier1Complete}/${tier1.length} complete`);
console.log("");

const next = vehicles
  .filter((v) => v.status === "pending" || v.status === "failed" || v.status === "downloading")
  .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || (a.priority ?? 0) - (b.priority ?? 0))
  .slice(0, 10);

if (next.length) {
  console.log("Next up to 10 downloads:");
  for (const v of next) {
    const hasParams = fs.existsSync(path.join(path.dirname(queuePath), "..", v.paramsFile));
    console.log(`  [tier ${v.tier}] ${v.id} — ${v.label}${hasParams ? "" : " (NO PARAMS)"}`);
  }
} else {
  const needs = vehicles
    .filter((v) => v.status === "needs_params")
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || (a.priority ?? 0) - (b.priority ?? 0))
    .slice(0, 10);
  console.log("No pending downloads. Next params to capture:");
  for (const v of needs) {
    console.log(`  [tier ${v.tier}] ${v.id} — ${v.ptsModel} ${v.modelYear}`);
  }
}

const complete = vehicles.filter((v) => v.status === "complete");
if (complete.length) {
  console.log("");
  console.log(`Recently complete (${Math.min(5, complete.length)} shown):`);
  for (const v of complete.slice(-5)) {
    console.log(`  ${v.id}`);
  }
}
NODE

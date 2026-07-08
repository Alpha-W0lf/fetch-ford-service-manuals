#!/usr/bin/env node
/**
 * Report and prune capture-gaps.json across the queue.
 *
 * Usage:
 *   node scripts/audit-capture-gaps.js              # all vehicles with gaps
 *   node scripts/audit-capture-gaps.js 2015-f-150   # one vehicle, prune resolved
 */
const fs = require("fs");
const path = require("path");
const {
  readCaptureGaps,
  gapsFilePath,
  CAPTURE_GAPS_FILE,
} = require("./capture-gaps-lib");

const ROOT = path.join(__dirname, "..");
const QUEUE_PATH = path.join(ROOT, "templates/vehicles.json");

function pruneResolved(outputDir, data) {
  const fullRoot = path.join(ROOT, outputDir);
  const kept = [];
  let removed = 0;
  for (const gap of data.gaps) {
    const target = path.join(fullRoot, gap.expectedFile);
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      removed += 1;
    } else {
      kept.push(gap);
    }
  }
  return { kept, removed };
}

function auditVehicle(v, { write = false }) {
  const file = gapsFilePath(ROOT, v.outputDir);
  if (!fs.existsSync(file)) {
    return { id: v.id, gaps: 0, pruned: 0, status: v.status };
  }

  const data = readCaptureGaps(ROOT, v.outputDir);
  const { kept, removed } = pruneResolved(v.outputDir, data);

  if (write && removed > 0) {
    const body = {
      version: 1,
      updatedAt: new Date().toISOString(),
      gaps: kept,
    };
    fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  }

  return {
    id: v.id,
    gaps: kept.length,
    pruned: removed,
    status: v.status,
    file,
    sample: kept.slice(0, 3),
  };
}

function main() {
  const q = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
  const targetId = process.argv[2];
  const vehicles = targetId
    ? (q.vehicles || []).filter((v) => v.id === targetId)
  : (q.vehicles || []);

  if (targetId && !vehicles.length) {
    console.error(`Vehicle not found: ${targetId}`);
    process.exit(1);
  }

  const results = vehicles
    .map((v) => auditVehicle(v, { write: !!targetId }))
    .filter((r) => r.gaps > 0 || r.pruned > 0);

  if (!results.length) {
    console.log(
      targetId
        ? `${targetId}: no capture gaps (${CAPTURE_GAPS_FILE})`
        : "No vehicles with capture gaps."
    );
    return;
  }

  for (const r of results) {
    console.log(
      `${r.id}: ${r.gaps} gap(s)${r.pruned ? `, pruned ${r.pruned} resolved` : ""} [queue: ${r.status}]`
    );
    for (const g of r.sample || []) {
      console.log(`  - [${g.section}] ${g.name} → ${g.expectedFile} (${g.reason})`);
    }
    if (r.gaps > (r.sample || []).length) {
      console.log(`  ... and ${r.gaps - r.sample.length} more in ${r.file}`);
    }
  }
}

main();

#!/usr/bin/env node
/**
 * Append expansion vehicles to templates/vehicles.json without changing existing entries.
 * Preserves order, priority, and status of all vehicles already in the queue.
 *
 * Usage:
 *   node scripts/append-vehicle-queue.js           # append missing expansion vehicles
 *   node scripts/append-vehicle-queue.js --dry-run # preview only
 */
const fs = require("fs");
const path = require("path");
const { allExpansionVehicles } = require("./vehicle-catalog-expansion");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "templates/vehicles.json");
const dryRun = process.argv.includes("--dry-run");

function main() {
  if (!fs.existsSync(OUT)) {
    console.error(`Queue not found: ${OUT}`);
    process.exit(1);
  }

  const queue = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const existing = queue.vehicles || [];
  const existingIds = new Set(existing.map((v) => v.id));
  const maxPriority = existing.reduce(
    (max, v) => Math.max(max, v.priority ?? 0),
    0
  );

  const candidates = allExpansionVehicles(maxPriority + 1);
  const toAdd = candidates.filter((v) => !existingIds.has(v.id));

  if (toAdd.length === 0) {
    console.log("No new vehicles to append — expansion catalog already applied.");
    return;
  }

  console.log(
    `Appending ${toAdd.length} vehicle(s) after priority ${maxPriority} (existing: ${existing.length})`
  );
  for (const v of toAdd) {
    console.log(`  + ${v.id} (p${v.priority}, tier ${v.tier}, ${v.phase})`);
  }

  if (dryRun) {
    console.log("\nDry run — vehicles.json unchanged.");
    return;
  }

  queue.vehicles = [...existing, ...toAdd];
  fs.writeFileSync(OUT, JSON.stringify(queue, null, 2) + "\n");
  console.log(`\nWrote ${queue.vehicles.length} vehicles to ${OUT}`);
  console.log(
    "Next: capture params for new vehicles — yarn capture-params --status needs_params"
  );
}

main();

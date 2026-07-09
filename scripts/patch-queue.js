#!/usr/bin/env node
/**
 * Patch one vehicle status in vehicles.json (re-reads file each call).
 * Atomic write (tmp + rename) to avoid corrupting JSON under concurrent use.
 *
 * Usage: node scripts/patch-queue.js <vehicleId> <status>
 */
const path = require("path");
const { patchVehicleStatus } = require("../lib/patch-queue");

const ROOT = path.join(__dirname, "..");
const QUEUE_PATH = path.join(ROOT, "templates/vehicles.json");

const [vehicleId, status] = process.argv.slice(2);
if (!vehicleId || !status) {
  console.error("Usage: node scripts/patch-queue.js <vehicleId> <status>");
  process.exit(1);
}

try {
  patchVehicleStatus(QUEUE_PATH, vehicleId, status);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

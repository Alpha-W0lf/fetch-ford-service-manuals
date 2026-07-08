#!/usr/bin/env node
/**
 * Patch one vehicle status in vehicles.json (re-reads file each call).
 * Atomic write (tmp + rename) to avoid corrupting JSON under concurrent use.
 *
 * Usage: node scripts/patch-queue.js <vehicleId> <status>
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const QUEUE_PATH = path.join(ROOT, "templates/vehicles.json");

const [vehicleId, status] = process.argv.slice(2);
if (!vehicleId || !status) {
  console.error("Usage: node scripts/patch-queue.js <vehicleId> <status>");
  process.exit(1);
}

const q = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
const v = (q.vehicles || []).find((x) => x.id === vehicleId);
if (!v) {
  console.error(`Vehicle not found: ${vehicleId}`);
  process.exit(1);
}

v.status = status;
v.updatedAt = new Date().toISOString();
const body = JSON.stringify(q, null, 2) + "\n";
const tmp = `${QUEUE_PATH}.tmp.${process.pid}`;
fs.writeFileSync(tmp, body);
fs.renameSync(tmp, QUEUE_PATH);

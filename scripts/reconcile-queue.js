#!/usr/bin/env node
/**
 * Align vehicles.json statuses with params files and download folders on disk.
 * Run before bulk-download or manually: node scripts/reconcile-queue.js
 */
const fs = require("fs");
const path = require("path");
const { verifyDownload } = require("./verify-download-lib");
const { hasCaptureGaps, captureGapCount } = require("./capture-gaps-lib");

const ROOT = path.join(__dirname, "..");
const QUEUE_PATH = path.join(ROOT, "templates/vehicles.json");

function main() {
  const q = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
  const defaults = q.defaults || {};
  let changes = 0;

  for (const v of q.vehicles || []) {
    const paramsPath = path.join(ROOT, v.paramsFile || "");
    const hasParams = v.paramsFile && fs.existsSync(paramsPath);
    const wantWorkshop = v.workshop !== false && defaults.workshop !== false;
    const wantWiring = v.wiring !== false && defaults.wiring !== false;
    const prev = v.status;
    const disk = verifyDownload(ROOT, v.outputDir, wantWorkshop, wantWiring);
    const gaps = captureGapCount(ROOT, v.outputDir);

    if (v.status === "skip") continue;

    if (disk.ok && v.status !== "complete") {
      v.status = "complete";
      changes++;
      console.log(`  ${v.id}: ${prev} → complete (verified on disk, ${disk.pdfs} PDFs)`);
      continue;
    }

    if (v.status === "downloading") {
      v.status = gaps > 0 ? "incomplete" : "pending";
      changes++;
      console.log(`  ${v.id}: downloading → ${v.status} (interrupted)`);
      continue;
    }

    if (v.status === "complete" && hasCaptureGaps(ROOT, v.outputDir)) {
      v.status = "incomplete";
      changes++;
      console.log(`  ${v.id}: complete → incomplete (${gaps} capture gap(s))`);
      continue;
    }

    if (v.status === "complete" && !disk.ok) {
      v.status = hasCaptureGaps(ROOT, v.outputDir) ? "incomplete" : "pending";
      changes++;
      console.log(`  ${v.id}: complete → ${v.status} (${disk.reason})`);
      continue;
    }

    if (v.status === "incomplete" && disk.ok) {
      v.status = "complete";
      changes++;
      console.log(`  ${v.id}: incomplete → complete (gaps filled)`);
      continue;
    }

    if ((v.status === "failed" || v.status === "incomplete") && hasParams && !disk.ok) {
      if (v.status === "failed") {
        v.status = gaps > 0 ? "incomplete" : "pending";
        changes++;
        console.log(`  ${v.id}: failed → ${v.status} (${disk.reason || "retry"})`);
      }
      continue;
    }

    if ((v.status === "pending" || v.status === "failed") && !hasParams) {
      v.status = "needs_params";
      changes++;
      console.log(`  ${v.id}: ${prev} → needs_params (no params.json)`);
      continue;
    }

    if (v.status === "needs_params" && hasParams) {
      v.status = "pending";
      changes++;
      console.log(`  ${v.id}: needs_params → pending (params found)`);
      continue;
    }
  }

  if (changes) {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2) + "\n");
    console.log(`Reconciled ${changes} vehicle(s).`);
  } else {
    console.log("Queue already consistent.");
  }
}

main();

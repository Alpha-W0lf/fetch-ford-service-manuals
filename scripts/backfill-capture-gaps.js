#!/usr/bin/env node
/**
 * Backfill capture-gaps.json from TOC/disk audit + vehicle logs.
 * Updates queue status for vehicles with gaps.
 *
 * Usage:
 *   node scripts/backfill-capture-gaps.js              # all vehicles with output dirs
 *   node scripts/backfill-capture-gaps.js 2015-f-150   # one vehicle
 *   node scripts/backfill-capture-gaps.js --dry-run    # report only
 */
const fs = require("fs");
const path = require("path");
const { auditVehicle, mergeGaps, buildExistingPathIndex, fileExistsForGap } = require("./capture-gaps-backfill-lib");
const {
  CAPTURE_GAPS_FILE,
  blockingGaps,
  hasQueueBlockingGaps,
  isHybridCompleteEligible,
  migrateTocAuditGaps,
  writeTocAuditReport,
} = require("./capture-gaps-lib");
const { verifyDownload } = require("./verify-download-lib");

const ROOT = path.join(__dirname, "..");
const QUEUE_PATH = path.join(ROOT, "templates/vehicles.json");

function loadExisting(root, outputDir) {
  const file = path.join(root, outputDir, CAPTURE_GAPS_FILE);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).gaps || [];
  } catch {
    return [];
  }
}

function writeGaps(root, outputDir, gaps) {
  const file = path.join(root, outputDir, CAPTURE_GAPS_FILE);
  const body = {
    version: 1,
    updatedAt: new Date().toISOString(),
    gaps,
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return file;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const targetId = args.find((a) => !a.startsWith("--"));

  const q = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
  let vehicles = q.vehicles || [];
  if (targetId) {
    vehicles = vehicles.filter((v) => v.id === targetId);
    if (!vehicles.length) {
      console.error(`Vehicle not found: ${targetId}`);
      process.exit(1);
    }
  } else {
    vehicles = vehicles.filter(
      (v) =>
        v.status !== "skip" &&
        v.status !== "downloading" &&
        v.status !== "pending" &&
        fs.existsSync(path.join(ROOT, v.outputDir))
    );
  }

  let totalGaps = 0;
  let vehiclesWithGaps = 0;
  let queueUpdates = 0;

  for (const v of vehicles) {
    if (!dryRun) {
      const migrated = migrateTocAuditGaps(ROOT, v.outputDir);
      if (migrated.moved > 0) {
        console.log(
          `  ${v.id}: moved ${migrated.moved} toc-audit gap(s) to toc-audit-report.json`
        );
      }
    }

    const existing = loadExisting(ROOT, v.outputDir);
    const audited = auditVehicle(ROOT, v.outputDir, v.id);
    const fullRoot = path.join(ROOT, v.outputDir);
    const pathIndex = buildExistingPathIndex(fullRoot);
    const gaps = mergeGaps(existing, audited).filter((g) => {
      if (g.source === "log-backfill" && !g.expectedFile) return false;
      if (!g.expectedFile) return true;
      return !fileExistsForGap(fullRoot, g.expectedFile, pathIndex);
    });
    const tocAuditGaps = gaps.filter((g) => g.source === "toc-audit");
    const blocking = blockingGaps(gaps);
    const queueBlocking = hasQueueBlockingGaps(gaps);

    if (!dryRun && tocAuditGaps.length) {
      writeTocAuditReport(ROOT, v.outputDir, tocAuditGaps);
    }

    if (!queueBlocking) {
      if (existing.length > 0 && !dryRun) {
        writeGaps(ROOT, v.outputDir, blocking);
      }
      if ((v.status === "incomplete" || blocking.length > 0) && !dryRun) {
        const d = q.defaults || {};
        const wantWorkshop = v.workshop !== false && d.workshop !== false;
        const wantWiring = v.wiring !== false && d.wiring !== false;
        if (verifyDownload(ROOT, v.outputDir, wantWorkshop, wantWiring).ok) {
          v.status = "complete";
          queueUpdates++;
          const note =
            blocking.length > 0 && isHybridCompleteEligible(gaps)
              ? `hybrid complete (${blocking.length} logged connector gap(s))`
              : "no blocking gaps";
          console.log(`  ${v.id}: → complete (${note})`);
        }
      }
      if (tocAuditGaps.length || blocking.length) {
        const hybrid =
          blocking.length > 0 && isHybridCompleteEligible(gaps) ? " [hybrid]" : "";
        console.log(
          `${v.id}: ${blocking.length} logged gap(s)${tocAuditGaps.length ? `, ${tocAuditGaps.length} toc-audit (informational)` : ""}${hybrid} [queue: ${v.status}]`
        );
      }
      continue;
    }

    totalGaps += blocking.length;
    vehiclesWithGaps++;
    const info =
      tocAuditGaps.length > 0
        ? `, ${tocAuditGaps.length} toc-audit (informational)`
        : "";
    console.log(
      `${v.id}: ${blocking.length} blocking gap(s)${info} [queue: ${v.status}]${dryRun ? " (dry-run)" : ""}`
    );

    if (!dryRun) {
      writeGaps(ROOT, v.outputDir, blocking);
      if (v.status === "complete" && queueBlocking) {
        v.status = "incomplete";
        queueUpdates++;
        console.log(`  → marked incomplete (blocking gaps)`);
      }
    }
  }

  if (!dryRun && queueUpdates) {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2) + "\n");
  }

  console.log("");
  console.log(
    `Audit done: ${vehiclesWithGaps} vehicle(s) with gaps, ${totalGaps} total gap(s)${dryRun ? " (dry-run)" : ""}`
  );
  if (queueUpdates && !dryRun) {
    console.log(`Queue updated: ${queueUpdates} vehicle(s)`);
  }
}

main();

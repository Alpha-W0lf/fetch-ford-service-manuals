#!/usr/bin/env node
/**
 * Read-only audit: find workshop trees with duplicate colon/dash section folders.
 *
 * Example duplicate pair:
 *   manuals/2009-f-250/1: General Information/
 *   manuals/2009-f-250/1- General Information/
 *
 * Usage:
 *   node scripts/audit-duplicate-trees.js
 *   node scripts/audit-duplicate-trees.js 2009-f-250
 *   node scripts/audit-duplicate-trees.js --json
 */
const fs = require("fs");
const path = require("path");
const { countPdfsUnder } = require("./path-resolve-lib");

const ROOT = path.join(__dirname, "..");
const MANUALS = path.join(ROOT, "manuals");

const SECTION_RE = /^(\d+)[: -] (.+)$/;

function auditVehicleDir(vehicleId, vehicleRoot) {
  let entries;
  try {
    entries = fs.readdirSync(vehicleRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const sections = entries
    .filter((e) => e.isDirectory() && SECTION_RE.test(e.name))
    .map((e) => e.name);

  const byPrefix = new Map();
  for (const name of sections) {
    const m = name.match(SECTION_RE);
    if (!m) continue;
    const key = `${m[1]}:${m[2]}`;
    if (!byPrefix.has(key)) byPrefix.set(key, []);
    byPrefix.get(key).push(name);
  }

  const duplicates = [];
  for (const [logical, names] of byPrefix) {
    if (names.length < 2) continue;
    const trees = names.map((dirName) => {
      const full = path.join(vehicleRoot, dirName);
      return {
        dirName,
        relPath: path.join(vehicleId, dirName),
        pdfCount: countPdfsUnder(full),
      };
    });
    trees.sort((a, b) => b.pdfCount - a.pdfCount);
    duplicates.push({
      section: logical,
      trees,
      totalPdfs: trees.reduce((n, t) => n + t.pdfCount, 0),
      wastedOverlap: trees.slice(1).reduce((n, t) => n + t.pdfCount, 0),
    });
  }

  if (!duplicates.length) return null;

  return {
    vehicleId,
    outputDir: path.relative(ROOT, vehicleRoot),
    duplicateSections: duplicates.length,
    duplicates,
  };
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const targetId = args.find((a) => !a.startsWith("--"));

  if (!fs.existsSync(MANUALS)) {
    console.error(`Manuals directory not found: ${MANUALS}`);
    process.exit(1);
  }

  let vehicleIds = fs
    .readdirSync(MANUALS)
    .filter((name) => {
      const full = path.join(MANUALS, name);
      try {
        return fs.statSync(full).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

  if (targetId) {
    vehicleIds = vehicleIds.filter((id) => id === targetId);
    if (!vehicleIds.length) {
      console.error(`Vehicle output not found: ${targetId}`);
      process.exit(1);
    }
  }

  const reports = [];
  for (const id of vehicleIds) {
    const report = auditVehicleDir(id, path.join(MANUALS, id));
    if (report) reports.push(report);
  }

  if (asJson) {
    console.log(JSON.stringify({ vehicles: reports, count: reports.length }, null, 2));
    process.exit(reports.length ? 1 : 0);
  }

  if (!reports.length) {
    console.log("No colon/dash duplicate section trees found.");
    process.exit(0);
  }

  console.log(`Found duplicate section trees on ${reports.length} vehicle(s):\n`);
  for (const r of reports) {
    console.log(`${r.vehicleId} (${r.duplicateSections} duplicated section prefix(es))`);
    for (const dup of r.duplicates) {
      console.log(`  Section ${dup.section}:`);
      for (const t of dup.trees) {
        const tag = t === dup.trees[0] ? " [primary — most PDFs]" : "";
        console.log(`    ${t.dirName}: ${t.pdfCount} PDF(s)${tag}`);
      }
      if (dup.wastedOverlap > 0) {
        console.log(
          `    Note: ${dup.wastedOverlap} PDF(s) in secondary tree(s) — review before any merge`
        );
      }
    }
    console.log("");
  }

  console.log(
    "Read-only audit — no files changed. resolveExistingSubdir() prefers the richer tree on new downloads."
  );
  process.exit(1);
}

main();

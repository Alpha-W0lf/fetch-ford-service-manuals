#!/usr/bin/env node
/**
 * Safely consolidate colon/dash duplicate workshop section trees.
 *
 * Rules (conservative):
 * - Primary tree = section dir with the most PDFs (same as audit).
 * - Move PDFs from secondary → primary only when relative path is absent in primary.
 * - If same relative path exists with identical size → delete secondary copy (dedupe).
 * - If same relative path exists with different size → skip and report conflict (no overwrite).
 * - Remove emptied secondary directories after successful apply.
 *
 * Usage:
 *   node scripts/merge-duplicate-trees.js              # dry-run all
 *   node scripts/merge-duplicate-trees.js --apply      # execute
 *   node scripts/merge-duplicate-trees.js 2009-f-250 --apply
 */
const fs = require("fs");
const path = require("path");
const { countPdfsUnder } = require("./path-resolve-lib");

const ROOT = path.join(__dirname, "..");
const MANUALS = path.join(ROOT, "manuals");
const SECTION_RE = /^(\d+)[: -] (.+)$/;

function listPdfs(sectionRoot) {
  const files = [];
  function walk(dir, rel = "") {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, relPath);
      else if (ent.isFile() && ent.name.endsWith(".pdf")) {
        const st = fs.statSync(full);
        files.push({ relPath, full, size: st.size });
      }
    }
  }
  walk(sectionRoot);
  return files;
}

function findDuplicateSections(vehicleRoot) {
  const entries = fs.readdirSync(vehicleRoot, { withFileTypes: true });
  const sections = entries.filter((e) => e.isDirectory() && SECTION_RE.test(e.name));
  const byPrefix = new Map();
  for (const ent of sections) {
    const m = ent.name.match(SECTION_RE);
    const key = `${m[1]}:${m[2]}`;
    if (!byPrefix.has(key)) byPrefix.set(key, []);
    byPrefix.get(key).push(ent.name);
  }
  const groups = [];
  for (const [logical, names] of byPrefix) {
    if (names.length < 2) continue;
    const trees = names
      .map((dirName) => ({
        dirName,
        full: path.join(vehicleRoot, dirName),
        pdfCount: countPdfsUnder(path.join(vehicleRoot, dirName)),
      }))
      .sort((a, b) => b.pdfCount - a.pdfCount);
    groups.push({ logical, primary: trees[0], secondaries: trees.slice(1) });
  }
  return groups;
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) removeEmptyDirs(path.join(dir, ent.name));
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function mergeSection(vehicleId, primary, secondary, apply) {
  const primaryPdfs = listPdfs(primary.full);
  const byRel = new Map(primaryPdfs.map((p) => [p.relPath, p]));
  const secondaryPdfs = listPdfs(secondary.full);

  const result = {
    vehicleId,
    section: primary.dirName,
    primary: primary.dirName,
    secondary: secondary.dirName,
    moved: 0,
    deduped: 0,
    conflicts: [],
    bytesMoved: 0,
    bytesDeduped: 0,
  };

  for (const sec of secondaryPdfs) {
    const existing = byRel.get(sec.relPath);
    const dest = path.join(primary.full, sec.relPath);

    if (existing) {
      if (existing.size === sec.size) {
        result.deduped += 1;
        result.bytesDeduped += sec.size;
        if (apply) fs.unlinkSync(sec.full);
      } else {
        result.conflicts.push({
          relPath: sec.relPath,
          primarySize: existing.size,
          secondarySize: sec.size,
        });
      }
      continue;
    }

    result.moved += 1;
    result.bytesMoved += sec.size;
    if (apply) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(sec.full, dest);
      byRel.set(sec.relPath, { relPath: sec.relPath, full: dest, size: sec.size });
    }
  }

  if (apply) removeEmptyDirs(secondary.full);
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const targetId = args.find((a) => !a.startsWith("--"));

  let vehicleIds = fs
    .readdirSync(MANUALS)
    .filter((name) => {
      try {
        return fs.statSync(path.join(MANUALS, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

  if (targetId) {
    vehicleIds = vehicleIds.filter((id) => id === targetId);
    if (!vehicleIds.length) {
      console.error(`Vehicle not found: ${targetId}`);
      process.exit(1);
    }
  }

  const allResults = [];
  for (const id of vehicleIds) {
    const vehicleRoot = path.join(MANUALS, id);
    const groups = findDuplicateSections(vehicleRoot);
    if (!groups.length) continue;

    console.log(`\n${id}${apply ? " [APPLY]" : " [dry-run]"}`);
    for (const g of groups) {
      for (const sec of g.secondaries) {
        const r = mergeSection(id, g.primary, sec, apply);
        allResults.push(r);
        console.log(
          `  ${g.logical}: ${sec.dirName} → ${g.primary.dirName}: moved=${r.moved} deduped=${r.deduped} conflicts=${r.conflicts.length}`
        );
        for (const c of r.conflicts.slice(0, 3)) {
          console.log(
            `    CONFLICT ${c.relPath} (primary ${c.primarySize} vs secondary ${c.secondarySize} bytes)`
          );
        }
        if (r.conflicts.length > 3) {
          console.log(`    ... ${r.conflicts.length - 3} more conflict(s)`);
        }
      }
    }
  }

  if (!allResults.length) {
    console.log("No duplicate section trees to merge.");
    process.exit(0);
  }

  const reportPath = path.join(ROOT, "logs/merge-duplicate-trees-report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        applied: apply,
        at: new Date().toISOString(),
        results: allResults,
        totals: {
          moved: allResults.reduce((n, r) => n + r.moved, 0),
          deduped: allResults.reduce((n, r) => n + r.deduped, 0),
          conflicts: allResults.reduce((n, r) => n + r.conflicts.length, 0),
        },
      },
      null,
      2
    ) + "\n"
  );

  console.log(`\nReport: ${reportPath}`);
  if (!apply) {
    console.log("Dry-run only — re-run with --apply to execute.");
  }
}

main();

#!/usr/bin/env node
/**
 * Lightweight PDF integrity audit — detects corrupt or HTML-error files saved as PDF.
 *
 * Usage:
 *   node scripts/audit-pdf-integrity.js              # all vehicles with manuals/
 *   node scripts/audit-pdf-integrity.js 2016-transit
 *   node scripts/audit-pdf-integrity.js --sample 30  # random sample across fleet
 *
 * Exit 1 if any issues found (for CI-style checks).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MANUALS = path.join(ROOT, "manuals");
const MIN_BYTES = parseInt(process.env.PDF_AUDIT_MIN_BYTES || "200", 10);
const REPORT_PATH = path.join(ROOT, "logs/pdf-integrity-report.json");

function readHead(filePath, len = 512) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function auditPdf(filePath) {
  const issues = [];
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return [{ type: "stat_error", message: "cannot read file" }];
  }

  if (size < MIN_BYTES) {
    issues.push({ type: "too_small", size, min: MIN_BYTES });
  }

  const head = readHead(filePath);
  const text = head.toString("utf8", 0, Math.min(head.length, 256));
  const isPdf = head.subarray(0, 5).toString() === "%PDF-";

  if (!isPdf) {
    if (/access denied|<html|<!doctype/i.test(text)) {
      issues.push({ type: "html_error_page", preview: text.slice(0, 120) });
    } else {
      issues.push({ type: "not_pdf", preview: text.slice(0, 80) });
    }
  }

  return issues;
}

function walkPdfs(dir, base = dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkPdfs(full, base, out);
    else if (ent.isFile() && ent.name.endsWith(".pdf")) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

function listVehicleIds() {
  if (!fs.existsSync(MANUALS)) return [];
  return fs
    .readdirSync(MANUALS)
    .filter((id) => {
      try {
        return fs.statSync(path.join(MANUALS, id)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function samplePaths(paths, n) {
  if (paths.length <= n) return paths;
  const picked = new Set();
  while (picked.size < n) {
    picked.add(paths[Math.floor(Math.random() * paths.length)]);
  }
  return [...picked];
}

function main() {
  const args = process.argv.slice(2);
  let sampleN = 0;
  const vehicleIds = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sample" && args[i + 1]) {
      sampleN = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith("--")) {
      vehicleIds.push(args[i]);
    }
  }

  const targets = vehicleIds.length ? vehicleIds : listVehicleIds();
  const report = {
    at: new Date().toISOString(),
    minBytes: MIN_BYTES,
    vehicles: [],
    totals: { pdfs: 0, issues: 0 },
  };

  for (const id of targets) {
    const vehicleRoot = path.join(MANUALS, id);
    if (!fs.existsSync(vehicleRoot)) {
      console.warn(`Skip ${id}: no manuals/${id}`);
      continue;
    }

    let relPaths = walkPdfs(vehicleRoot);
    if (sampleN > 0 && vehicleIds.length === 0) {
      relPaths = samplePaths(relPaths, sampleN);
    }

    const vehicleReport = { id, pdfs: relPaths.length, bad: [] };
    for (const rel of relPaths) {
      const full = path.join(vehicleRoot, rel);
      const issues = auditPdf(full);
      report.totals.pdfs += 1;
      if (issues.length) {
        report.totals.issues += 1;
        vehicleReport.bad.push({ path: rel, issues });
      }
    }

    if (vehicleReport.bad.length) {
      console.log(`${id}: ${vehicleReport.bad.length} issue(s) / ${vehicleReport.pdfs} PDFs`);
      for (const b of vehicleReport.bad.slice(0, 5)) {
        console.log(`  ${b.path}: ${b.issues.map((i) => i.type).join(", ")}`);
      }
      if (vehicleReport.bad.length > 5) {
        console.log(`  ... ${vehicleReport.bad.length - 5} more`);
      }
    } else if (vehicleIds.length || sampleN === 0) {
      console.log(`${id}: OK (${vehicleReport.pdfs} PDFs)`);
    }

    report.vehicles.push(vehicleReport);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nReport: ${REPORT_PATH}`);
  console.log(`Totals: ${report.totals.issues} issue(s) in ${report.totals.pdfs} PDF(s) scanned`);

  if (report.totals.issues > 0) process.exit(1);
}

main();

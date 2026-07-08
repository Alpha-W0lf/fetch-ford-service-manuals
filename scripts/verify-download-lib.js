/**
 * Shared download verification (used by reconcile-queue and bulk-download).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { hasCaptureGaps, captureGapCount, readCaptureGaps } = require("./capture-gaps-lib");

function countPdfs(dir) {
  try {
    return parseInt(
      execSync(`find "${dir}" -name '*.pdf' 2>/dev/null | wc -l`, { encoding: "utf8" }).trim(),
      10
    );
  } catch {
    return 0;
  }
}

function connectorCoverage(full) {
  const connDir = path.join(full, "Wiring", "Connector Views");
  const manifest = path.join(connDir, "connectors.json");
  if (!fs.existsSync(manifest)) {
    return { ok: true, expected: 0, actual: 0 };
  }
  let expected = 0;
  try {
    expected = JSON.parse(fs.readFileSync(manifest, "utf8")).length;
  } catch {
    return { ok: false, reason: "invalid connectors.json" };
  }
  let actual = 0;
  try {
    actual = fs
      .readdirSync(connDir)
      .filter((f) => f.endsWith(".pdf")).length;
  } catch {
    actual = 0;
  }
  if (actual < expected) {
    return {
      ok: false,
      reason: `connector PDFs ${actual}/${expected}`,
      expected,
      actual,
    };
  }
  return { ok: true, expected, actual };
}

function verifyDownload(root, outputDir, wantWorkshop = true, wantWiring = true) {
  const full = path.join(root, outputDir);
  if (!fs.existsSync(full)) return { ok: false, reason: "no output dir" };

  const gaps = captureGapCount(root, outputDir);
  if (hasCaptureGaps(root, outputDir)) {
    return { ok: false, reason: `capture gaps (${gaps})`, gaps };
  }

  const total = countPdfs(full);
  const wiringDir = path.join(full, "Wiring");
  const hasWiring = fs.existsSync(wiringDir);
  const wiringToc = fs.existsSync(path.join(wiringDir, "toc.json"));
  const cover = fs.existsSync(path.join(full, "cover.html"));

  if (total < 50) return { ok: false, reason: `too few PDFs (${total})`, gaps: 0 };
  if (!cover) return { ok: false, reason: "missing cover.html", gaps: 0 };
  if (wantWiring && (!hasWiring || !wiringToc)) {
    return { ok: false, reason: "missing wiring (toc.json)", gaps: 0 };
  }
  if (wantWorkshop && total < 100 && !hasWiring) {
    return { ok: false, reason: "likely workshop incomplete", gaps: 0 };
  }

  if (wantWiring) {
    const conn = connectorCoverage(full);
    if (!conn.ok) {
      return { ok: false, reason: conn.reason, gaps: 0 };
    }
  }

  return { ok: true, pdfs: total, gaps: 0 };
}

/** True when incomplete vehicle should retry connectors only (workshop done, connector gaps remain). */
function shouldConnectorOnlyRetry(root, outputDir) {
  const full = path.join(root, outputDir);
  const wiringToc = path.join(full, "Wiring", "toc.json");
  const cover = path.join(full, "cover.html");
  if (!fs.existsSync(wiringToc) || !fs.existsSync(cover)) return false;

  const gaps = readCaptureGaps(root, outputDir).gaps;
  const hasConnectorGaps = gaps.some((g) => g.section === "wiring-connector");
  const hasWorkshopGaps = gaps.some((g) => g.section === "workshop");
  if (hasConnectorGaps && !hasWorkshopGaps) return true;

  const conn = connectorCoverage(full);
  return !conn.ok && conn.expected > 0;
}

module.exports = {
  countPdfs,
  connectorCoverage,
  shouldConnectorOnlyRetry,
  verifyDownload,
};

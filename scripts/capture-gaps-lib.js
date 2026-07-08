/**
 * Shared capture-gaps.json helpers (used by bulk-download, reconcile, audit).
 */
const fs = require("fs");
const path = require("path");

const CAPTURE_GAPS_FILE = "capture-gaps.json";
const TOC_AUDIT_REPORT_FILE = "toc-audit-report.json";

/** Hybrid complete: tolerate a few exhausted connector-audit gaps (see env). */
const HYBRID_COMPLETE_MAX_GAPS = parseInt(
  process.env.HYBRID_COMPLETE_MAX_GAPS || "5",
  10
);
const HYBRID_COMPLETE_MIN_ATTEMPTS = parseInt(
  process.env.HYBRID_COMPLETE_MIN_ATTEMPTS || "3",
  10
);

/** TOC leaf audit gaps are informational — not queue-blocking (many 403 on CDN). */
function isBlockingGap(gap) {
  if (gap?.source === "toc-audit") return false;
  // Log-scraped rows without a resolvable path are not actionable.
  if (gap?.source === "log-backfill" && !gap?.expectedFile) return false;
  return true;
}

function blockingGaps(gaps) {
  return (gaps || []).filter(isBlockingGap);
}

/**
 * Queue may treat vehicle as complete when only a few connector-audit gaps remain
 * and each has been attempted at least HYBRID_COMPLETE_MIN_ATTEMPTS times.
 * Gaps remain in capture-gaps.json for visibility.
 */
function isHybridCompleteEligible(gaps) {
  const blocking = blockingGaps(gaps);
  if (blocking.length === 0) return true;
  if (blocking.length > HYBRID_COMPLETE_MAX_GAPS) return false;
  return blocking.every(
    (g) =>
      g.source === "connector-audit" &&
      (g.attempts || 0) >= HYBRID_COMPLETE_MIN_ATTEMPTS
  );
}

/** True when gaps should block queue status / verify / worker priority. */
function hasQueueBlockingGaps(gaps) {
  const blocking = blockingGaps(gaps);
  if (blocking.length === 0) return false;
  return !isHybridCompleteEligible(gaps);
}

function queueBlockingGapCount(gaps) {
  return hasQueueBlockingGaps(gaps) ? blockingGaps(gaps).length : 0;
}

function gapsFilePath(root, outputDir) {
  return path.join(root, outputDir, CAPTURE_GAPS_FILE);
}

function readCaptureGaps(root, outputDir) {
  const file = gapsFilePath(root, outputDir);
  if (!fs.existsSync(file)) {
    return { version: 1, updatedAt: null, gaps: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: data.version || 1,
      updatedAt: data.updatedAt || null,
      gaps: Array.isArray(data.gaps) ? data.gaps : [],
    };
  } catch {
    return { version: 1, updatedAt: null, gaps: [] };
  }
}

function hasCaptureGaps(root, outputDir) {
  return hasQueueBlockingGaps(readCaptureGaps(root, outputDir).gaps);
}

function captureGapCount(root, outputDir) {
  return queueBlockingGapCount(readCaptureGaps(root, outputDir).gaps);
}

function readTocAuditReport(root, outputDir) {
  const file = path.join(root, outputDir, TOC_AUDIT_REPORT_FILE);
  if (!fs.existsSync(file)) {
    return { version: 1, updatedAt: null, gaps: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: data.version || 1,
      updatedAt: data.updatedAt || null,
      gaps: Array.isArray(data.gaps) ? data.gaps : [],
    };
  } catch {
    return { version: 1, updatedAt: null, gaps: [] };
  }
}

function writeTocAuditReport(root, outputDir, gaps) {
  const file = path.join(root, outputDir, TOC_AUDIT_REPORT_FILE);
  const body = {
    version: 1,
    updatedAt: new Date().toISOString(),
    gaps,
    note:
      "Informational TOC leaf audit only — not used for queue status. Many entries are variant-specific or CDN-blocked.",
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return file;
}

/** Move legacy toc-audit rows out of capture-gaps.json into toc-audit-report.json. */
function migrateTocAuditGaps(root, outputDir) {
  const { gaps } = readCaptureGaps(root, outputDir);
  const tocAudit = gaps.filter((g) => g.source === "toc-audit");
  if (!tocAudit.length) return { moved: 0, blocking: gaps.length };

  const blocking = blockingGaps(gaps);
  const report = readTocAuditReport(root, outputDir);
  const byId = new Map(report.gaps.map((g) => [g.id, g]));
  for (const g of tocAudit) byId.set(g.id, g);
  writeTocAuditReport(root, outputDir, [...byId.values()]);

  const file = gapsFilePath(root, outputDir);
  const body = {
    version: 1,
    updatedAt: new Date().toISOString(),
    gaps: blocking,
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return { moved: tocAudit.length, blocking: blocking.length };
}

module.exports = {
  CAPTURE_GAPS_FILE,
  TOC_AUDIT_REPORT_FILE,
  HYBRID_COMPLETE_MAX_GAPS,
  HYBRID_COMPLETE_MIN_ATTEMPTS,
  isBlockingGap,
  blockingGaps,
  isHybridCompleteEligible,
  hasQueueBlockingGaps,
  queueBlockingGapCount,
  gapsFilePath,
  readCaptureGaps,
  readTocAuditReport,
  writeTocAuditReport,
  migrateTocAuditGaps,
  hasCaptureGaps,
  captureGapCount,
};

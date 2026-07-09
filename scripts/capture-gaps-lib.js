/**
 * Shared capture-gaps.json helpers (used by bulk-download, reconcile, audit).
 */
const fs = require("fs");
const path = require("path");
const rules = require("../lib/capture-gaps-rules");

const CAPTURE_GAPS_FILE = "capture-gaps.json";
const TOC_AUDIT_REPORT_FILE = "toc-audit-report.json";

const {
  isBlockingGap,
  blockingGaps,
  isHybridCompleteEligible,
  hasQueueBlockingGaps,
  queueBlockingGapCount,
  parseHybridMaxGaps,
  parseHybridMinAttempts,
} = rules;

const HYBRID_COMPLETE_MAX_GAPS = parseHybridMaxGaps();
const HYBRID_COMPLETE_MIN_ATTEMPTS = parseHybridMinAttempts();

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

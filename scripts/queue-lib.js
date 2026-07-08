/**
 * Shared bulk-queue selection (used by bulk-download.sh).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { readCaptureGaps, blockingGaps, hasQueueBlockingGaps } = require("./capture-gaps-lib");

const STALE_GAP_ATTEMPTS = parseInt(process.env.STALE_GAP_ATTEMPTS || "10", 10);

function pdfCount(root, outputDir) {
  const full = path.join(root, outputDir);
  if (!fs.existsSync(full)) return 0;
  return parseInt(
    execSync(`find "${full}" -name '*.pdf' 2>/dev/null | wc -l`, {
      encoding: "utf8",
    }).trim(),
    10
  );
}

function isQueued(v, root) {
  if (v.status === "incomplete") return true;
  if (v.status === "pending") return true;
  if (v.status === "failed") return pdfCount(root, v.outputDir) >= 50;
  return false;
}

/**
 * True when every open gap has been retried at least STALE_GAP_ATTEMPTS times
 * without resolving — likely a permanent bug, not a transient failure.
 */
function isStaleIncomplete(root, outputDir) {
  const gaps = readCaptureGaps(root, outputDir).gaps;
  if (!hasQueueBlockingGaps(gaps)) return false;
  const blocking = blockingGaps(gaps);
  if (!blocking.length) return false;
  const minAttempts = Math.min(...blocking.map((g) => g.attempts || 0));
  return minAttempts >= STALE_GAP_ATTEMPTS;
}

/**
 * Lower rank = higher priority.
 * Tier 1 anchors get TIER1_BOOST subtracted so breadth anchors finish before tier 2 fill.
 *
 * Bands (before tier sort within band):
 *   incomplete fresh tier 1  → ~-10
 *   incomplete fresh tier 2+ → 0
 *   failed tier 1            → 0
 *   pending tier 1           → 10
 *   failed tier 2+           → 10
 *   pending tier 2+          → 20
 *   incomplete stale         → 20–30
 */
const TIER1_BOOST = 10;

function queueRank(v, root) {
  const tier = v.tier ?? 99;
  const boost = tier === 1 ? TIER1_BOOST : 0;

  if (v.status === "incomplete") {
    const stale = isStaleIncomplete(root, v.outputDir);
    return (stale ? 30 : 0) - boost;
  }
  if (v.status === "failed") return 10 - boost;
  return 20 - boost; // pending
}

function sortQueued(vehicles, root) {
  return [...vehicles].sort(
    (a, b) =>
      queueRank(a, root) - queueRank(b, root) ||
      (a.tier ?? 99) - (b.tier ?? 99) ||
      (a.priority ?? 0) - (b.priority ?? 0)
  );
}

function listQueued(root, queuePath, excludeIds = []) {
  const exclude = new Set(excludeIds.filter(Boolean));
  const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  return sortQueued(
    (q.vehicles || []).filter((v) => isQueued(v, root) && !exclude.has(v.id)),
    root
  );
}

function countPending(root, queuePath, excludeIds = []) {
  return listQueued(root, queuePath, excludeIds).length;
}

function nextJob(root, queuePath, excludeIds = []) {
  const pending = listQueued(root, queuePath, excludeIds);
  if (!pending.length) return null;
  const v = pending[0];
  const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  const d = q.defaults || {};
  const workshop = v.workshop !== false && d.workshop !== false;
  const wiring = v.wiring !== false && d.wiring !== false;
  return { v, workshop, wiring, stale: isStaleIncomplete(root, v.outputDir) };
}

module.exports = {
  STALE_GAP_ATTEMPTS,
  pdfCount,
  isQueued,
  isStaleIncomplete,
  queueRank,
  sortQueued,
  listQueued,
  countPending,
  nextJob,
};

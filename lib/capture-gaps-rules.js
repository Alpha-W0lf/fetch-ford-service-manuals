/**
 * Pure capture-gap classification rules (canonical contract: docs/reference/schemas.md).
 * No filesystem I/O — safe for unit tests and shared by JS scripts + TS worker.
 */

function parseHybridMaxGaps() {
  return parseInt(process.env.HYBRID_COMPLETE_MAX_GAPS || "5", 10);
}

function parseHybridMinAttempts() {
  return parseInt(process.env.HYBRID_COMPLETE_MIN_ATTEMPTS || "3", 10);
}

/** Log-scraped rows without a resolvable path are not actionable. */
function isOrphanLogBackfillGap(gap) {
  return gap?.source === "log-backfill" && !gap?.expectedFile;
}

/** TOC leaf audit gaps are informational — not queue-blocking. */
function isBlockingGap(gap) {
  if (gap?.source === "toc-audit") return false;
  if (isOrphanLogBackfillGap(gap)) return false;
  return true;
}

function blockingGaps(gaps) {
  return (gaps || []).filter(isBlockingGap);
}

/**
 * Queue may treat vehicle as complete when only a few connector-audit gaps remain
 * and each has been attempted at least HYBRID_COMPLETE_MIN_ATTEMPTS times.
 */
function isHybridCompleteEligible(gaps, options = {}) {
  const maxGaps = options.maxGaps ?? parseHybridMaxGaps();
  const minAttempts = options.minAttempts ?? parseHybridMinAttempts();
  const blocking = blockingGaps(gaps);
  if (blocking.length === 0) return true;
  if (blocking.length > maxGaps) return false;
  return blocking.every(
    (g) =>
      g.source === "connector-audit" &&
      (g.attempts || 0) >= minAttempts
  );
}

/** True when gaps should block queue status / verify / worker priority. */
function hasQueueBlockingGaps(gaps, options = {}) {
  const blocking = blockingGaps(gaps);
  if (blocking.length === 0) return false;
  return !isHybridCompleteEligible(gaps, options);
}

function queueBlockingGapCount(gaps, options = {}) {
  return hasQueueBlockingGaps(gaps, options) ? blockingGaps(gaps).length : 0;
}

module.exports = {
  isOrphanLogBackfillGap,
  isBlockingGap,
  blockingGaps,
  isHybridCompleteEligible,
  hasQueueBlockingGaps,
  queueBlockingGapCount,
  parseHybridMaxGaps,
  parseHybridMinAttempts,
};

/**
 * Download verification helpers for bulk orchestrator (parity with bulk-download.sh).
 */
const { verifyDownload, shouldConnectorOnlyRetry } = require("../scripts/verify-download-lib");
const { hasCaptureGaps } = require("../scripts/capture-gaps-lib");

function verifyDownloadOk(root, outputDir, workshop, wiring) {
  return verifyDownload(root, outputDir, workshop, wiring).ok;
}

/** @returns {'complete' | 'incomplete' | 'failed'} */
function resolveDownloadStatus(root, outputDir, workshop, wiring) {
  const result = verifyDownload(root, outputDir, workshop, wiring);
  if (result.ok) return "complete";
  if (hasCaptureGaps(root, outputDir)) return "incomplete";
  return "failed";
}

module.exports = {
  verifyDownloadOk,
  resolveDownloadStatus,
  shouldConnectorOnlyRetry,
};

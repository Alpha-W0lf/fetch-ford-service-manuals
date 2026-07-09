/**
 * Auth-failure circuit breaker (parity with bulk-download.sh).
 */
const fs = require("fs");

function recentAuthFailureCount(stampsFile, windowSec = 900) {
  if (!fs.existsSync(stampsFile)) return 0;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSec;
  const lines = fs.readFileSync(stampsFile, "utf8").split("\n");
  let count = 0;
  for (const line of lines) {
    const ts = parseInt(line.trim(), 10);
    if (Number.isFinite(ts) && ts >= cutoff) count += 1;
  }
  return count;
}

function recordAuthFailure(stampsFile, vehicleId, logFn = console.log) {
  fs.appendFileSync(stampsFile, `${Math.floor(Date.now() / 1000)}\n`);
  logFn(`[circuit] Auth failure recorded for ${vehicleId}`);
}

function clearAuthFailureStamps(stampsFile) {
  try {
    fs.rmSync(stampsFile, { force: true });
  } catch {
    /* */
  }
}

function tripCircuitBreaker(backoffSec, logFn = console.log) {
  const backoffUntil = Math.floor(Date.now() / 1000) + backoffSec;
  logFn("");
  logFn(
    `[circuit] Auth failures threshold reached — pausing new jobs for ${backoffSec}s`
  );
  return backoffUntil;
}

function isCircuitBreakerActive(backoffUntil) {
  return backoffUntil > Math.floor(Date.now() / 1000);
}

function circuitRemainingSec(backoffUntil) {
  return Math.max(0, backoffUntil - Math.floor(Date.now() / 1000));
}

module.exports = {
  recentAuthFailureCount,
  recordAuthFailure,
  clearAuthFailureStamps,
  tripCircuitBreaker,
  isCircuitBreakerActive,
  circuitRemainingSec,
};

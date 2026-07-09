/**
 * Process liveness check for orchestrator stale-worker reaping.
 */

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

module.exports = { isProcessAlive };

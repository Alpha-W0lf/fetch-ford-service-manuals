/**
 * Serialized single-vehicle queue patch (mkdir lock + read → modify → tmp + rename).
 * Lock path: `<queuePath>.patch-lock/` (portable; no flock).
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_LOCK_WAIT_MS = parseInt(
  process.env.PATCH_QUEUE_LOCK_MS || "30000",
  10
);

function patchLockDir(queuePath) {
  return `${queuePath}.patch-lock`;
}

function isPidAlive(pid) {
  const n = parseInt(String(pid), 10);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function removeStalePatchLock(queuePath) {
  const dir = patchLockDir(queuePath);
  if (!fs.existsSync(dir)) return;
  try {
    const pid = fs.readFileSync(path.join(dir, "pid"), "utf8").trim();
    if (isPidAlive(pid)) return;
  } catch {
    /* treat as stale */
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * @returns {boolean}
 */
function acquirePatchLock(queuePath, maxWaitMs = DEFAULT_LOCK_WAIT_MS) {
  const dir = patchLockDir(queuePath);
  const start = Date.now();
  while (true) {
    removeStalePatchLock(queuePath);
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "pid"), `${process.pid}\n`);
      return true;
    } catch {
      if (Date.now() - start >= maxWaitMs) return false;
      const end = Date.now() + 10;
      while (Date.now() < end) {
        /* brief spin */
      }
    }
  }
}

function releasePatchLock(queuePath) {
  const dir = patchLockDir(queuePath);
  if (!fs.existsSync(dir)) return;
  try {
    const current = fs.readFileSync(path.join(dir, "pid"), "utf8").trim();
    if (current !== String(process.pid)) return;
  } catch {
    /* */
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Read-modify-write one vehicle (caller must hold patch lock).
 */
function applyVehiclePatch(queuePath, vehicleId, status) {
  const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  const v = (q.vehicles || []).find((x) => x.id === vehicleId);
  if (!v) {
    throw new Error(`Vehicle not found: ${vehicleId}`);
  }

  v.status = status;
  v.updatedAt = new Date().toISOString();
  const body = JSON.stringify(q, null, 2) + "\n";
  const tmp = `${queuePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, queuePath);
  return { vehicleId, status, updatedAt: v.updatedAt };
}

/**
 * @param {string} queuePath
 * @param {string} vehicleId
 * @param {string} status
 * @returns {{ vehicleId: string, status: string, updatedAt: string }}
 */
function patchVehicleStatus(queuePath, vehicleId, status) {
  if (!acquirePatchLock(queuePath)) {
    throw new Error(
      `Timed out waiting for patch-queue lock (${DEFAULT_LOCK_WAIT_MS}ms)`
    );
  }
  try {
    return applyVehiclePatch(queuePath, vehicleId, status);
  } finally {
    releasePatchLock(queuePath);
  }
}

module.exports = {
  DEFAULT_LOCK_WAIT_MS,
  patchLockDir,
  acquirePatchLock,
  releasePatchLock,
  applyVehiclePatch,
  patchVehicleStatus,
};

/**
 * Atomic single-vehicle queue patch (read → modify one entry → tmp + rename).
 * Prevents corrupt JSON under concurrent writers; does not serialize lost-update races
 * when two processes patch different vehicles simultaneously (last rename wins).
 */
const fs = require("fs");

/**
 * @param {string} queuePath
 * @param {string} vehicleId
 * @param {string} status
 * @returns {{ vehicleId: string, status: string, updatedAt: string }}
 */
function patchVehicleStatus(queuePath, vehicleId, status) {
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

module.exports = { patchVehicleStatus };

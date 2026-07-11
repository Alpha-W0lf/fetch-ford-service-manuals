/**
 * Per-vehicle auth fast-fail cooldown store (Guide 04.3).
 * Orchestrator single-writer; atomic file persistence.
 */
const fs = require("fs");
const path = require("path");

function emptyState() {
  return { version: 1, vehicles: {} };
}

function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function loadState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return emptyState();
    return {
      version: 1,
      vehicles:
        raw.vehicles && typeof raw.vehicles === "object" ? raw.vehicles : {},
    };
  } catch {
    return emptyState();
  }
}

/**
 * @param {string} file
 * @param {{ fastFailSec?: number, fastFailCount?: number, cooldownSec?: number, nowMs?: () => number }} [options]
 */
function createVehicleCooldownStore(file, options = {}) {
  const fastFailSec = options.fastFailSec ?? 60;
  const fastFailCount = options.fastFailCount ?? 3;
  const cooldownSec = options.cooldownSec ?? 900;
  const nowMs = options.nowMs ?? (() => Date.now());

  let state = loadState(file);

  function persist() {
    atomicWriteJson(file, state);
  }

  function pruneExpired(now = nowMs()) {
    let changed = false;
    for (const rec of Object.values(state.vehicles)) {
      if (rec.excludedUntil && rec.excludedUntil <= now) {
        rec.excludedUntil = 0;
        changed = true;
      }
    }
    if (changed) persist();
  }

  function isExcluded(vid, now = nowMs()) {
    const rec = state.vehicles[vid];
    if (!rec?.excludedUntil) return false;
    return rec.excludedUntil > now;
  }

  function getExcludedIds(now = nowMs()) {
    pruneExpired(now);
    return Object.keys(state.vehicles).filter((vid) => isExcluded(vid, now));
  }

  function clearAuthCooldowns() {
    state = emptyState();
    persist();
  }

  /**
   * @param {string} vid
   * @param {{ runtimeSec: number, authClass: string|null, finalStatus: string, authBudgetStop?: boolean }} outcome
   * @returns {{ counted: boolean, excluded: boolean, excludedUntil: number, consecutive: number }}
   */
  function recordOutcome(vid, outcome) {
    const { runtimeSec, authClass, finalStatus, authBudgetStop = false } =
      outcome;
    const result = {
      counted: false,
      excluded: false,
      excludedUntil: 0,
      consecutive: state.vehicles[vid]?.consecutiveFastAuth ?? 0,
    };

    if (finalStatus !== "incomplete" || !authClass) {
      return result;
    }

    const fastEnough =
      authBudgetStop === true || runtimeSec < fastFailSec;
    if (!fastEnough) {
      return result;
    }

    const now = nowMs();
    const rec = state.vehicles[vid] || {
      consecutiveFastAuth: 0,
      excludedUntil: 0,
      lastAuthClass: null,
    };

    rec.consecutiveFastAuth += 1;
    rec.lastAuthClass = authClass;
    result.counted = true;
    result.consecutive = rec.consecutiveFastAuth;

    if (rec.consecutiveFastAuth >= fastFailCount) {
      rec.excludedUntil = now + cooldownSec * 1000;
      result.excluded = true;
      result.excludedUntil = rec.excludedUntil;
    }

    state.vehicles[vid] = rec;
    persist();
    return result;
  }

  return {
    recordOutcome,
    isExcluded,
    getExcludedIds,
    pruneExpired,
    clearAuthCooldowns,
    _getState: () => state,
  };
}

module.exports = {
  createVehicleCooldownStore,
};

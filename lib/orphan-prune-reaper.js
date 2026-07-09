/**
 * Reap orphan prune-cdp-tabs processes not owned by the live orchestrator/worker tree.
 * Guide 04.2 — REL-03.
 */
const { spawnSync: defaultSpawnSync } = require("child_process");

/**
 * @param {string} etime ps etime field (MM:SS, HH:MM:SS, or DD-HH:MM:SS)
 * @returns {number} age in minutes
 */
function parseEtimeMinutes(etime) {
  if (!etime) return 0;
  if (etime.includes("-")) {
    const [days, rest] = etime.split("-");
    const parts = rest.split(":").map(Number);
    const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
    return (
      parseInt(days, 10) * 24 * 60 +
      h * 60 +
      m +
      (Number.isFinite(s) ? s : 0) / 60
    );
  }
  const parts = etime.split(":").map(Number);
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  return 0;
}

/**
 * @param {import('child_process').SpawnSyncReturns<string>} deps
 * @returns {{ pid: number, ppid: number, etime: string, command: string }[]}
 */
function readPsTable(deps) {
  const spawnSync = deps.spawnSync ?? defaultSpawnSync;
  const r = spawnSync("ps", ["-eo", "pid,ppid,etime,command"], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout) return [];

  return r.stdout
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: parseInt(match[1], 10),
        ppid: parseInt(match[2], 10),
        etime: match[3],
        command: match[4],
      };
    })
    .filter(Boolean);
}

/**
 * PIDs in the subtree of any root (orchestrator + in-flight yarn workers).
 * @param {number[]} rootPids
 * @param {{ pid: number, ppid: number }[]} rows
 */
function collectProtectedPids(rootPids, rows) {
  const protectedSet = new Set();
  const byPpid = new Map();
  for (const row of rows) {
    if (!byPpid.has(row.ppid)) byPpid.set(row.ppid, []);
    byPpid.get(row.ppid).push(row.pid);
  }
  const queue = rootPids.filter((p) => p && p > 0);
  while (queue.length) {
    const pid = queue.shift();
    if (protectedSet.has(pid)) continue;
    protectedSet.add(pid);
    for (const child of byPpid.get(pid) || []) {
      queue.push(child);
    }
  }
  return protectedSet;
}

/**
 * @param {number} orchestratorPid
 * @param {number[]} inFlightPids
 * @param {number} maxAgeMin
 * @param {object} deps
 * @returns {number[]}
 */
function listOrphanPrunePids(orchestratorPid, inFlightPids, maxAgeMin, deps) {
  if (maxAgeMin <= 0) return [];
  const rows = readPsTable(deps);
  const protectedSet = collectProtectedPids(
    [orchestratorPid, ...inFlightPids],
    rows
  );
  const orphans = [];
  for (const row of rows) {
    if (!row.command.includes("prune-cdp-tabs")) continue;
    if (protectedSet.has(row.pid)) continue;
    if (parseEtimeMinutes(row.etime) < maxAgeMin) continue;
    orphans.push(row.pid);
  }
  return orphans;
}

/**
 * @param {object} config
 * @param {{ inFlight: object[] }} state
 * @param {object} deps
 */
function reapOrphanPrunes(config, state, deps) {
  if (config.pruneOrphanMaxAgeMin <= 0) return;
  const orchestratorPid = deps.orchestratorPid ?? process.pid;
  const inFlightPids = (state.inFlight || [])
    .filter((e) => !e.done && e.pid)
    .map((e) => e.pid);
  const pids = listOrphanPrunePids(
    orchestratorPid,
    inFlightPids,
    config.pruneOrphanMaxAgeMin,
    deps
  );
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      deps.log(`[reap-prune] killed orphan prune-cdp-tabs pid ${pid}`);
    } catch (err) {
      if (err && err.code !== "ESRCH") {
        deps.log(`[reap-prune] failed to kill pid ${pid}: ${err.message}`);
      }
    }
  }
}

module.exports = {
  parseEtimeMinutes,
  readPsTable,
  collectProtectedPids,
  listOrphanPrunePids,
  reapOrphanPrunes,
};

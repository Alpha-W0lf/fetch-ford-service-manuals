/**
 * Bulk download orchestrator — poll loop, workers, cookies, maintenance.
 * Parity with scripts/bulk-download.sh (Guide 04).
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { patchVehicleStatus } = require("./patch-queue");
const { nextJob, countPending, isStaleIncomplete } = require("../scripts/queue-lib");
const {
  verifyDownloadOk,
  resolveDownloadStatus,
  shouldConnectorOnlyRetry,
} = require("./bulk-download-status");
const {
  recentAuthFailureCount,
  recordAuthFailure,
  clearAuthFailureStamps,
  tripCircuitBreaker,
  isCircuitBreakerActive,
  circuitRemainingSec,
} = require("./bulk-circuit-breaker");
const { authFailureIsRecent } = require("./bulk-auth-log");
const { createVehicleCooldownStore } = require("./vehicle-cooldown");
const { readCaptureGaps, blockingGaps } = require("../scripts/capture-gaps-lib");
const { isProcessAlive: defaultIsProcessAlive } = require("./process-alive");
const { reapOrphanPrunes } = require("./orphan-prune-reaper");

const DEFAULT_DEPS = {
  spawn,
  spawnSync,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (...args) => console.log(...args),
  nowSec: () => Math.floor(Date.now() / 1000),
  fetch: globalThis.fetch.bind(globalThis),
};

/**
 * @param {string[]} argv process.argv
 * @param {NodeJS.ProcessEnv} [env]
 */
function loadConfig(argv, env = process.env) {
  const root = path.join(__dirname, "..");
  const queueArg = argv[2] || "templates/vehicles.json";
  const queuePath = path.isAbsolute(queueArg)
    ? queueArg
    : path.join(root, queueArg);

  if (!fs.existsSync(queuePath)) {
    throw new Error(`Queue file not found: ${queuePath}`);
  }

  const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  const cookieRel = q.cookieFile || "templates/cookieString.txt";
  const cookiePath = path.join(root, cookieRel);

  if (!fs.existsSync(cookiePath)) {
    throw new Error(
      "Missing templates/cookieString.txt — refresh cookies from PTS first."
    );
  }

  const parallel = parseInt(env.PARALLEL || String(q.parallel || 1), 10);

  return {
    root,
    queuePath,
    queueRel: path.relative(root, queuePath) || queueArg,
    parallel,
    cookieFile: cookieRel,
    pollSec: parseInt(env.POLL_SEC || "15", 10),
    idleExitMin: parseInt(env.IDLE_EXIT_MIN || "0", 10),
    cookieRefreshMin: parseInt(env.COOKIE_REFRESH_MIN || "180", 10),
    circuitBreakerThreshold: parseInt(
      env.CIRCUIT_BREAKER_THRESHOLD || "2",
      10
    ),
    circuitBreakerBackoffSec: parseInt(
      env.CIRCUIT_BREAKER_BACKOFF_SEC || "600",
      10
    ),
    staleGapAttempts: parseInt(env.STALE_GAP_ATTEMPTS || "10", 10),
    reconcileEveryMin: parseInt(env.RECONCILE_EVERY_MIN || "60", 10),
    pdfAuditEveryMin: parseInt(env.PDF_AUDIT_EVERY_MIN || "120", 10),
    pdfAuditSample: parseInt(env.PDF_AUDIT_SAMPLE || "50", 10),
    skipBackfillOnStart: env.SKIP_BACKFILL_ON_START !== "0",
    logDir: path.join(root, "logs"),
    recent403File: path.join(root, "logs", "recent-403-stamps.txt"),
    workerLogStaleMs: parseInt(env.WORKER_LOG_STALE_MS || "1200000", 10),
    workerMaxRuntimeMs: parseInt(env.WORKER_MAX_RUNTIME_MS || "14400000", 10),
    workerKillGraceMs: parseInt(env.WORKER_KILL_GRACE_MS || "5000", 10),
    pruneOrphanMaxAgeMin: parseInt(env.PRUNE_ORPHAN_MAX_AGE_MIN || "30", 10),
    vehicleFastFailSec: parseInt(env.VEHICLE_FAST_FAIL_SEC || "60", 10),
    vehicleFastFailCount: parseInt(env.VEHICLE_FAST_FAIL_COUNT || "3", 10),
    vehicleCooldownSec: parseInt(env.VEHICLE_COOLDOWN_SEC || "900", 10),
    vehicleCooldownFile: path.join(
      root,
      env.VEHICLE_COOLDOWN_FILE || "logs/vehicle-cooldown.json"
    ),
    vehicleAuthEventsFile: path.join(
      root,
      env.VEHICLE_AUTH_EVENTS_FILE || "logs/recent-auth-events.jsonl"
    ),
  };
}

function idleLimitTicks(config) {
  if (config.idleExitMin === 0) return 999_999_999;
  return Math.floor((config.idleExitMin * 60) / config.pollSec);
}

/**
 * Map yarn exit + disk verify to queue status (parity with run_one tail).
 * @returns {{ status: string, success: boolean }}
 */
function resolveFinalVehicleStatus(exitCode, diskStatus) {
  if (exitCode === 0 && diskStatus === "complete") {
    return { status: "complete", success: true };
  }
  if (diskStatus === "incomplete" && exitCode === 0) {
    return { status: "incomplete", success: false };
  }
  return { status: "failed", success: false };
}

function readVehicleQueueStatus(queuePath, vehicleId) {
  const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  const v = (q.vehicles || []).find((x) => x.id === vehicleId);
  if (!v) return null;
  const d = q.defaults || {};
  const workshop = v.workshop !== false && d.workshop !== false;
  const wiring = v.wiring !== false && d.wiring !== false;
  return { v, workshop, wiring };
}

/**
 * Fix orphaned `downloading` when worker exited without final patch.
 * @returns {boolean} true if patched
 */
function fixOrphanDownloading(config, vehicleId, exitCode, deps = DEFAULT_DEPS) {
  const meta = readVehicleQueueStatus(config.queuePath, vehicleId);
  if (!meta || meta.v.status !== "downloading") return false;

  const diskStatus = resolveDownloadStatus(
    config.root,
    meta.v.outputDir,
    meta.workshop,
    meta.wiring
  );
  const { status } = resolveFinalVehicleStatus(exitCode, diskStatus);
  patchVehicleStatus(config.queuePath, vehicleId, status);
  deps.log(
    `[reap] Orphan downloading fixed: ${vehicleId} → ${status} (exit ${exitCode}, disk ${diskStatus})`
  );
  return true;
}

function inFlightExcludeCsv(inFlight) {
  return inFlight.map((e) => e.vid).filter(Boolean).join(",");
}

async function cdpAvailable(deps) {
  try {
    const res = await deps.fetch("http://127.0.0.1:9222/json/version");
    return res.ok;
  } catch {
    return false;
  }
}

async function refreshCookies(config, state, deps) {
  if (config.cookieRefreshMin === 0) return false;
  if (!(await cdpAvailable(deps))) {
    deps.log("[cookies] PTS Chrome CDP not available on :9222 — skip refresh");
    return false;
  }
  deps.log("[cookies] Refreshing from PTS Chrome...");
  const logPath = path.join(config.logDir, "cookie-refresh.log");
  const r = deps.spawnSync(
    "node",
    [path.join(config.root, "scripts/export-cookies-from-chrome.js")],
    {
      cwd: config.root,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    }
  );
  fs.appendFileSync(logPath, `${r.stdout || ""}${r.stderr || ""}`);
  if (r.status === 0) {
    state.lastCookieRefresh = deps.nowSec();
    clearAuthFailureStamps(config.recent403File);
    deps.log("[cookies] Refreshed OK");
    return true;
  }
  deps.log("[cookies] Refresh failed — see logs/cookie-refresh.log");
  return false;
}

async function maybeRefreshCookies(config, state, deps) {
  if (config.cookieRefreshMin === 0) return;
  const now = deps.nowSec();
  const due = state.lastCookieRefresh + config.cookieRefreshMin * 60;
  if (state.lastCookieRefresh !== 0 && now < due) return;
  if (await refreshCookies(config, state, deps)) {
    await connectorPreflight(config, state, deps);
  }
}

function connectorPreflight(config, state, deps = DEFAULT_DEPS) {
  deps.log("Preflight: connector portal access...");
  const logPath = path.join(config.logDir, "connector-preflight.log");
  const r = deps.spawnSync(
    "npx",
    ["ts-node", path.join(config.root, "scripts/test-connector-cookies.ts")],
    { cwd: config.root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
  );
  fs.appendFileSync(logPath, `${r.stdout || ""}${r.stderr || ""}`);
  if (r.status !== 0) {
    deps.log(
      "Connector preflight FAILED — log into PTS Chrome and refresh cookies:"
    );
    deps.log("  node scripts/export-cookies-from-chrome.js");
    try {
      const tail = fs.readFileSync(logPath, "utf8").split("\n").slice(-5);
      for (const line of tail) deps.log(line);
    } catch {
      /* */
    }
    return false;
  }
  deps.log("Connector preflight OK");
  clearAuthFailureStamps(config.recent403File);
  state?.vehicleCooldown?.clearAuthCooldowns();
  return true;
}

function preflightCheck(config, deps = DEFAULT_DEPS) {
  deps.log("Preflight: TypeScript compile check...");
  const errPath = path.join(config.logDir, "preflight.err");
  const r = deps.spawnSync("npx", ["tsc", "--noEmit"], {
    cwd: config.root,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) {
    fs.writeFileSync(errPath, `${r.stderr || ""}${r.stdout || ""}`);
    deps.log("Preflight FAILED — fix TypeScript errors before bulk run:");
    deps.log(fs.readFileSync(errPath, "utf8"));
    throw new Error("TypeScript preflight failed");
  }
  deps.log("Preflight OK");
}

function maybeReconcileQueue(config, state, deps) {
  if (config.reconcileEveryMin === 0) return;
  const now = deps.nowSec();
  const due = state.lastReconcile + config.reconcileEveryMin * 60;
  if (state.lastReconcile !== 0 && now < due) return;
  deps.log(
    `[reconcile] Periodic queue reconcile (every ${config.reconcileEveryMin}min, workers idle)...`
  );
  const logPath = path.join(config.logDir, "reconcile-periodic.log");
  const r = deps.spawnSync(
    "node",
    [path.join(config.root, "scripts/reconcile-queue.js")],
    { cwd: config.root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
  );
  fs.appendFileSync(logPath, `${r.stdout || ""}${r.stderr || ""}`);
  state.lastReconcile = now;
}

function maybePdfSpotCheck(config, state, deps) {
  if (config.pdfAuditEveryMin === 0) return;
  const now = deps.nowSec();
  const due = state.lastPdfAudit + config.pdfAuditEveryMin * 60;
  if (state.lastPdfAudit !== 0 && now < due) return;
  deps.log(
    `[audit] PDF integrity spot-check (sample ${config.pdfAuditSample})...`
  );
  const logPath = path.join(config.logDir, "pdf-integrity-spotcheck.log");
  const r = deps.spawnSync(
    "node",
    [
      path.join(config.root, "scripts/audit-pdf-integrity.js"),
      "--sample",
      String(config.pdfAuditSample),
    ],
    { cwd: config.root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
  );
  fs.appendFileSync(logPath, `${r.stdout || ""}${r.stderr || ""}`);
  if (r.status === 0) {
    deps.log("[audit] PDF spot-check OK — see logs/pdf-integrity-spotcheck.log");
  } else {
    deps.log(
      "[audit] PDF spot-check found issues — see logs/pdf-integrity-spotcheck.log"
    );
  }
  state.lastPdfAudit = now;
}

function maybePeriodicMaintenance(config, state, running, deps) {
  if (running !== 0) return;
  maybeReconcileQueue(config, state, deps);
  maybePdfSpotCheck(config, state, deps);
}

function patchStaleWorkerFromDisk(config, vehicleId, deps = DEFAULT_DEPS) {
  const meta = readVehicleQueueStatus(config.queuePath, vehicleId);
  if (!meta || meta.v.status !== "downloading") return { patched: false };

  const disk = resolveDownloadStatus(
    config.root,
    meta.v.outputDir,
    meta.workshop,
    meta.wiring
  );
  const status =
    disk === "complete"
      ? "complete"
      : disk === "incomplete"
        ? "incomplete"
        : "failed";
  patchVehicleStatus(config.queuePath, vehicleId, status);
  deps.log(
    `[reap-stale] disk patch: ${vehicleId} → ${status} (disk ${disk})`
  );
  return {
    patched: true,
    status,
    exitCode: status === "complete" ? 0 : 1,
  };
}

function reapStaleWorkers(config, state, deps = DEFAULT_DEPS) {
  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive;

  for (const entry of state.inFlight) {
    if (entry.done || !entry.pid || isAlive(entry.pid)) continue;

    const patchResult = patchStaleWorkerFromDisk(config, entry.vid, deps);
    if (!patchResult.patched) continue;

    const { status, exitCode } = patchResult;
    entry.reaped = true;
    entry.done = true;
    entry.exitCode = exitCode;
    entry._resolveWorker?.(exitCode);
    deps.log(`[reap-stale] ${entry.vid} pid ${entry.pid} dead → ${status}`);
  }
}

function getVehicleLogMtime(logPath, deps = DEFAULT_DEPS) {
  const statSync = deps.statSync ?? fs.statSync;
  try {
    return statSync(logPath).mtimeMs;
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function forceKillWorker(config, entry, deps = DEFAULT_DEPS) {
  if (!entry.pid) return;
  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  try {
    process.kill(entry.pid, "SIGTERM");
  } catch (err) {
    if (!err || err.code !== "ESRCH") throw err;
    return;
  }
  await deps.sleep(config.workerKillGraceMs);
  if (isAlive(entry.pid)) {
    try {
      process.kill(entry.pid, "SIGKILL");
    } catch (err) {
      if (!err || err.code !== "ESRCH") throw err;
    }
  }
}

async function reapHungWorkers(config, state, deps = DEFAULT_DEPS) {
  if (config.workerLogStaleMs === 0 && config.workerMaxRuntimeMs === 0) {
    return;
  }
  const now = Date.now();
  const isAlive = deps.isProcessAlive ?? defaultIsProcessAlive;

  for (const entry of state.inFlight) {
    if (entry.done) continue;

    const runtimeExceeded =
      entry.startedAt != null &&
      config.workerMaxRuntimeMs > 0 &&
      now - entry.startedAt > config.workerMaxRuntimeMs;

    let logStale = false;
    if (entry.pid && config.workerLogStaleMs > 0 && entry.logPath) {
      const mtime = getVehicleLogMtime(entry.logPath, deps);
      if (
        mtime != null &&
        now - mtime > config.workerLogStaleMs &&
        isAlive(entry.pid)
      ) {
        logStale = true;
      }
    }

    if (!logStale && !runtimeExceeded) continue;

    const reason = logStale ? "log-stale" : "max-runtime";
    await forceKillWorker(config, entry, deps);
    const patchResult = patchStaleWorkerFromDisk(config, entry.vid, deps);
    if (!patchResult.patched) continue;

    const { status, exitCode } = patchResult;
    entry.reaped = true;
    entry.done = true;
    entry.exitCode = exitCode;
    entry._resolveWorker?.(exitCode);
    deps.log(
      `[reap-hung] ${entry.vid} pid ${entry.pid ?? "none"} → ${reason} → ${status}`
    );
  }
}

function logHeartbeat(config, state, deps = DEFAULT_DEPS) {
  if (!state.inFlight.length) return;
  const now = Date.now();
  const parts = state.inFlight.map((entry) => {
    const ageSec =
      entry.startedAt != null
        ? Math.floor((now - entry.startedAt) / 1000)
        : "-";
    let logAgeSec = "-";
    if (entry.logPath) {
      const mtime = getVehicleLogMtime(entry.logPath, deps);
      if (mtime != null) {
        logAgeSec = String(Math.floor((now - mtime) / 1000));
      }
    }
    return `${entry.vid}=pid:${entry.pid ?? "pending"} age:${ageSec}s logAge:${logAgeSec}s`;
  });
  deps.log(
    `[heartbeat] inFlight=${state.inFlight.length} | ${parts.join(" | ")}`
  );
}

function isAuthGapReason(reason) {
  return reason === "auth" || reason === "subscription-expired";
}

function classifyIncompleteAuth(root, out, logPath) {
  const gapsData = readCaptureGaps(root, out);
  for (const g of blockingGaps(gapsData.gaps)) {
    if (isAuthGapReason(g.reason)) return g.reason;
  }
  if (!authFailureIsRecent(logPath)) return null;
  try {
    const text = fs.readFileSync(logPath, "utf8");
    if (/subscriptionExpired|subscription-expired/i.test(text)) {
      return "subscription-expired";
    }
  } catch {
    /* */
  }
  return "auth";
}

function appendAuthEvent(file, { vid, reason, finalStatus }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    `${JSON.stringify({
      vid,
      ts: new Date().toISOString(),
      reason,
      finalStatus,
    })}\n`
  );
}

function markStatus(config, vid, status) {
  patchVehicleStatus(config.queuePath, vid, status);
}

function spawnYarnStart(config, yarnArgs, logPath, entry, deps = DEFAULT_DEPS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code ?? 1);
    };

    const logStream = fs.createWriteStream(logPath);
    const child = deps.spawn("yarn", ["start", ...yarnArgs], {
      cwd: config.root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (entry) {
      entry.pid = child.pid ?? null;
      entry._resolveWorker = finish;
    }
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    logStream.on("error", (err) => {
      deps.log(`[worker-log] stream error for ${logPath}: ${err.message}`);
    });
    child.on("close", (code) => {
      logStream.end();
      finish(code ?? 1);
    });
    child.on("error", (err) => {
      deps.log(`[worker-log] child error for ${logPath}: ${err.message}`);
      finish(1);
    });
  });
}

/**
 * Run one vehicle download (parity with run_one).
 * @returns {Promise<number>} exit code (0 ok, 1 fail, 2 needs_params)
 */
async function runOne(
  config,
  job,
  deps = DEFAULT_DEPS,
  orchestratorState = null,
  entry = null
) {
  const { v, workshop, wiring } = job;
  const vid = v.id;
  const params = v.paramsFile;
  const out = v.outputDir;
  const paramsPath = path.join(config.root, params);

  if (!fs.existsSync(paramsPath)) {
    deps.log(`MISSING params for ${vid} — marking needs_params`);
    markStatus(config, vid, "needs_params");
    return 2;
  }

  if (verifyDownloadOk(config.root, out, workshop, wiring)) {
    deps.log(`SKIP ${vid} — already verified on disk`);
    markStatus(config, vid, "complete");
    return 0;
  }

  deps.spawnSync("bash", [
    path.join(config.root, "scripts/clean-partial-download.sh"),
    vid,
  ], { cwd: config.root, stdio: "ignore" });

  fs.mkdirSync(path.join(config.root, out), { recursive: true });
  markStatus(config, vid, "downloading");
  if (entry) entry.startedAt = Date.now();

  const cookieState = orchestratorState || { lastCookieRefresh: 0 };
  await refreshCookies(config, cookieState, deps);

  if (entry?.reaped) return entry.exitCode ?? 1;

  const flags = ["--noCookieTest", "--ignoreSaveErrors", "--noParamsValidation"];
  if (!workshop) flags.push("--noWorkshop");
  if (!wiring) flags.push("--noWiring");

  if (shouldConnectorOnlyRetry(config.root, out) && wiring) {
    deps.log(
      "  mode: connectors-only retry (workshop/wiring pages already on disk)"
    );
    flags.push("--noWorkshop", "--connectorsOnly");
  }

  if (isStaleIncomplete(config.root, out)) {
    deps.log(
      `  mode: stale-gap retry (deprioritized — every gap has ${config.staleGapAttempts}+ attempts)`
    );
  }

  deps.log("");
  deps.log("========================================");
  deps.log(`START ${vid} (parallel slot)`);
  deps.log(`  params: ${params}`);
  deps.log(`  output: ${out}`);
  deps.log(`  log:    logs/${vid}.log`);
  deps.log("========================================");

  const yarnArgs = [
    "-c",
    params,
    "-s",
    config.cookieFile,
    "-o",
    out,
    ...flags,
  ];
  const logPath = path.join(config.logDir, `${vid}.log`);
  const yarnStartedAt = Date.now();
  const exitCode = await spawnYarnStart(config, yarnArgs, logPath, entry, deps);

  if (entry?.reaped) return entry.exitCode ?? 1;

  const diskStatus = resolveDownloadStatus(
    config.root,
    out,
    workshop,
    wiring
  );
  const final = resolveFinalVehicleStatus(exitCode, diskStatus);

  if (final.status === "complete") {
    deps.log(`OK: ${vid} (verified, no gaps)`);
    markStatus(config, vid, "complete");
    return 0;
  }
  if (final.status === "incomplete") {
    deps.log(
      `INCOMPLETE: ${vid} — capture gaps remain (see ${out}/capture-gaps.json)`
    );
    markStatus(config, vid, "incomplete");
    const authClass = classifyIncompleteAuth(config.root, out, logPath);
    if (authClass) {
      deps.log(`[auth-incomplete] ${vid} — ${authClass}`);
      recordAuthFailure(config.recent403File, vid, deps.log);
      appendAuthEvent(config.vehicleAuthEventsFile, {
        vid,
        reason: authClass,
        finalStatus: "incomplete",
      });
      if (orchestratorState?.vehicleCooldown) {
        const runtimeSec = (Date.now() - yarnStartedAt) / 1000;
        const cd = orchestratorState.vehicleCooldown.recordOutcome(vid, {
          runtimeSec,
          authClass,
          finalStatus: "incomplete",
        });
        if (cd.excluded) {
          deps.log(
            `[cooldown] ${vid} excluded for ${config.vehicleCooldownSec}s after ${cd.consecutive} fast auth incomplete(s)`
          );
        }
      }
    }
    return 1;
  }

  if (diskStatus === "incomplete" && exitCode !== 0) {
    deps.log(
      `FAIL: ${vid} (exit ${exitCode} during run; gaps on disk) — see logs/${vid}.log`
    );
  } else {
    deps.log(
      `FAIL: ${vid} (exit ${exitCode} or incomplete download) — see logs/${vid}.log`
    );
  }
  if (authFailureIsRecent(logPath)) {
    recordAuthFailure(config.recent403File, vid, deps.log);
  }
  markStatus(config, vid, "failed");
  return 1;
}

async function waitForInFlight(config, state, deps, maxWaitMs = 3_600_000) {
  const start = Date.now();
  while (state.inFlight.some((e) => !e.done)) {
    await reapHungWorkers(config, state, deps);
    reapStaleWorkers(config, state, deps);
    await reapWorkers(config, state, deps);
    if (!state.inFlight.some((e) => !e.done)) break;
    if (Date.now() - start >= maxWaitMs) {
      deps.log("[shutdown] Timed out waiting for in-flight workers");
      break;
    }
    await deps.sleep(1000);
  }
  await reapHungWorkers(config, state, deps);
  reapStaleWorkers(config, state, deps);
  await reapWorkers(config, state, deps);
}

function installShutdownHandlers(state, deps) {
  const onSignal = (sig) => {
    if (state.shutdownRequested) return;
    state.shutdownRequested = true;
    deps.log(`\n${sig} received — finishing in-flight workers, then exiting...`);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

async function reapWorkers(config, state, deps = DEFAULT_DEPS) {
  const still = [];
  for (const entry of state.inFlight) {
    if (!entry.done) {
      still.push(entry);
      continue;
    }
    fixOrphanDownloading(config, entry.vid, entry.exitCode ?? 1, deps);
    const code = entry.exitCode ?? 1;
    // Exit 2 = needs_params (not a download failure); exit 1 = failed/incomplete job.
    if (code === 1) state.failures += 1;
  }
  state.inFlight = still;
}

function circuitBreakerBlocksStart(state, config, deps) {
  if (isCircuitBreakerActive(state.backoffUntil)) return true;
  const failures = recentAuthFailureCount(config.recent403File);
  if (failures >= config.circuitBreakerThreshold) {
    state.backoffUntil = tripCircuitBreaker(
      config.circuitBreakerBackoffSec,
      deps.log
    );
    refreshCookies(config, state, deps).catch(() => {});
    return true;
  }
  return false;
}

function startWorkers(config, state, deps = DEFAULT_DEPS) {
  if (state.shutdownRequested) return;
  if (circuitBreakerBlocksStart(state, config, deps)) return;

  while (true) {
    const running = state.inFlight.length;
    if (running >= config.parallel) break;

    const exclude = inFlightExcludeCsv(state.inFlight);
    const excludeIds = exclude ? exclude.split(",").filter(Boolean) : [];
    if (state.vehicleCooldown) {
      state.vehicleCooldown.pruneExpired();
      for (const vid of state.vehicleCooldown.getExcludedIds()) {
        if (!excludeIds.includes(vid)) excludeIds.push(vid);
      }
    }
    const job = nextJob(config.root, config.queuePath, excludeIds);
    if (!job) break;

    const entry = {
      vid: job.v.id,
      done: false,
      exitCode: null,
      pid: null,
      reaped: false,
      startedAt: null,
      logPath: path.join(config.logDir, `${job.v.id}.log`),
      _resolveWorker: null,
    };
    state.inFlight.push(entry);

    runOne(config, job, deps, state, entry)
      .then((code) => {
        entry.exitCode = code;
        entry.done = true;
      })
      .catch(() => {
        entry.exitCode = 1;
        entry.done = true;
      });
  }
}

async function runStartup(config, state, deps = DEFAULT_DEPS) {
  fs.mkdirSync(config.logDir, { recursive: true });
  deps.log(
    `Bulk downloader: parallel=${config.parallel} poll=${config.pollSec}s idle_exit=${config.idleExitMin}min cookie_refresh=${config.cookieRefreshMin}min`
  );
  preflightCheck(config, deps);
  deps.log("Reconciling queue with disk...");
  if (config.skipBackfillOnStart) {
    deps.log(
      "[reconcile] Skipping backfill-capture-gaps on start (set SKIP_BACKFILL_ON_START=0 to enable)"
    );
  } else {
    deps.log(
      "[reconcile] backfill-capture-gaps (may take a few minutes on large fleet)..."
    );
    deps.spawnSync(
      "node",
      [path.join(config.root, "scripts/backfill-capture-gaps.js")],
      { cwd: config.root, stdio: "ignore" }
    );
  }
  deps.log("[reconcile] reconcile-queue...");
  deps.spawnSync(
    "node",
    [path.join(config.root, "scripts/reconcile-queue.js")],
    { cwd: config.root, stdio: "inherit" }
  );
  state.lastReconcile = deps.nowSec();
  state.lastPdfAudit = deps.nowSec();

  await refreshCookies(config, state, deps);
  const ok = connectorPreflight(config, state, deps);
  if (!ok) {
    deps.log(
      "WARNING: Connector preflight failed — new jobs may fail until cookies are refreshed."
    );
    deps.log(
      `         Keep PTS Chrome logged in; bulk will retry cookie export every ${config.cookieRefreshMin}min.`
    );
  }
}

/**
 * One iteration of the main poll loop (exported for tests).
 */
async function orchestratorTick(config, state, deps = DEFAULT_DEPS) {
  if (state.vehicleCooldown) state.vehicleCooldown.pruneExpired();
  await reapHungWorkers(config, state, deps);
  reapStaleWorkers(config, state, deps);
  await reapWorkers(config, state, deps);
  reapOrphanPrunes(config, state, deps);
  await maybeRefreshCookies(config, state, deps);

  let running = state.inFlight.length;
  maybePeriodicMaintenance(config, state, running, deps);

  if (isCircuitBreakerActive(state.backoffUntil)) {
    if (running === 0 && (await refreshCookies(config, state, deps))) {
      deps.log("[circuit] Cookies refreshed with no workers — resuming job queue");
      state.backoffUntil = 0;
      startWorkers(config, state, deps);
    } else {
      const remaining = circuitRemainingSec(state.backoffUntil);
      deps.log(
        `[circuit] Backoff active — ${remaining}s until new jobs (${running} worker(s) still running)`
      );
    }
  } else {
    startWorkers(config, state, deps);
  }

  running = state.inFlight.length;
  const exclude = inFlightExcludeCsv(state.inFlight);
  const excludeIds = exclude ? exclude.split(",").filter(Boolean) : [];
  const pending = countPending(config.root, config.queuePath, excludeIds);
  const maxIdleTicks = idleLimitTicks(config);

  if (running === 0 && pending === 0) {
    state.idleTicks += 1;
    if (state.idleTicks >= maxIdleTicks) {
      return { done: true, sleepMs: 0 };
    }
    deps.log(
      `[poll] waiting for pending vehicles (${state.idleTicks}/${maxIdleTicks} idle checks, poll ${config.pollSec}s)...`
    );
    return { done: false, sleepMs: config.pollSec * 1000 };
  }

  state.idleTicks = 0;
  if (state.inFlight.length > 0) {
    logHeartbeat(config, state, deps);
  }
  const sleepMs = running > 0 ? 5000 : config.pollSec * 1000;
  return { done: false, sleepMs };
}

/**
 * @returns {Promise<number>} process exit code
 */
async function runOrchestrator(config, deps = DEFAULT_DEPS) {
  const state = {
    failures: 0,
    idleTicks: 0,
    inFlight: [],
    lastCookieRefresh: 0,
    lastReconcile: 0,
    lastPdfAudit: 0,
    backoffUntil: 0,
    shutdownRequested: false,
    vehicleCooldown: createVehicleCooldownStore(config.vehicleCooldownFile, {
      fastFailSec: config.vehicleFastFailSec,
      fastFailCount: config.vehicleFastFailCount,
      cooldownSec: config.vehicleCooldownSec,
    }),
  };

  installShutdownHandlers(state, deps);

  await runStartup(config, state, deps);

  while (true) {
    if (state.shutdownRequested) {
      await waitForInFlight(config, state, deps);
      deps.log("Shutdown complete.");
      break;
    }
    const tick = await orchestratorTick(config, state, deps);
    if (tick.done) {
      deps.log("");
      deps.log(
        `No pending work for ${config.idleExitMin} minutes — exiting.`
      );
      break;
    }
    await deps.sleep(tick.sleepMs);
  }

  deps.log("");
  if (state.failures === 0) {
    deps.log("Bulk run finished with no failures.");
    return 0;
  }
  deps.log(`Bulk run finished with ${state.failures} failure(s).`);
  return 1;
}

module.exports = {
  DEFAULT_DEPS,
  loadConfig,
  idleLimitTicks,
  resolveFinalVehicleStatus,
  fixOrphanDownloading,
  patchStaleWorkerFromDisk,
  inFlightExcludeCsv,
  maybePeriodicMaintenance,
  orchestratorTick,
  runOne,
  runOrchestrator,
  reapWorkers,
  reapStaleWorkers,
  reapHungWorkers,
  forceKillWorker,
  getVehicleLogMtime,
  logHeartbeat,
  startWorkers,
  circuitBreakerBlocksStart,
  waitForInFlight,
  installShutdownHandlers,
  spawnYarnStart,
  isAuthGapReason,
  classifyIncompleteAuth,
  connectorPreflight,
};

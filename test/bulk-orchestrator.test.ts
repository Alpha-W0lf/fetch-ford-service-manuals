import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  circuitBreakerBlocksStart,
  fixOrphanDownloading,
  getVehicleLogMtime,
  idleLimitTicks,
  inFlightExcludeCsv,
  logHeartbeat,
  orchestratorTick,
  patchStaleWorkerFromDisk,
  resolveFinalVehicleStatus,
  runOne,
  reapHungWorkers,
  reapWorkers,
  reapStaleWorkers,
} from "../lib/bulk-orchestrator-lib.js";
import {
  recentAuthFailureCount,
  tripCircuitBreaker,
} from "../lib/bulk-circuit-breaker.js";

describe("bulk-orchestrator-lib", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tmpRoots.length = 0;
    vi.restoreAllMocks();
  });

  function mkRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-bulk-orch-"));
    tmpRoots.push(root);
    fs.mkdirSync(path.join(root, "logs"), { recursive: true });
    fs.mkdirSync(path.join(root, "templates"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "templates/cookieString.txt"),
      "session=abc\n"
    );
    return root;
  }

  function writeQueue(
    root: string,
    vehicles: Record<string, unknown>[]
  ): string {
    const queuePath = path.join(root, "vehicles.json");
    fs.writeFileSync(
      queuePath,
      JSON.stringify(
        {
          cookieFile: "templates/cookieString.txt",
          parallel: 2,
          defaults: { workshop: true, wiring: true },
          vehicles,
        },
        null,
        2
      ) + "\n"
    );
    return queuePath;
  }

  function writeMinimalPdfs(dir: string, count: number): void {
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < count; i++) {
      fs.writeFileSync(path.join(dir, `doc-${i}.pdf`), `%PDF-${i}\n`);
    }
  }

  function mkCompleteManual(root: string, outputDir: string): void {
    const full = path.join(root, outputDir);
    writeMinimalPdfs(full, 55);
    fs.writeFileSync(path.join(full, "cover.html"), "<html></html>");
    const wiring = path.join(full, "Wiring");
    fs.mkdirSync(wiring, { recursive: true });
    fs.writeFileSync(path.join(wiring, "toc.json"), "[]");
    const conn = path.join(wiring, "Connector Views");
    fs.mkdirSync(conn, { recursive: true });
    fs.writeFileSync(path.join(conn, "connectors.json"), "[]");
    fs.writeFileSync(
      path.join(full, "capture-gaps.json"),
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        gaps: [],
      })
    );
  }

  function mkIncompleteManual(root: string, outputDir: string): void {
    const full = path.join(root, outputDir);
    writeMinimalPdfs(full, 55);
    fs.writeFileSync(path.join(full, "cover.html"), "<html></html>");
    const wiring = path.join(full, "Wiring");
    fs.mkdirSync(wiring, { recursive: true });
    fs.writeFileSync(path.join(wiring, "toc.json"), "[]");
    const conn = path.join(wiring, "Connector Views");
    fs.mkdirSync(conn, { recursive: true });
    fs.writeFileSync(path.join(conn, "connectors.json"), "[]");
    fs.writeFileSync(
      path.join(full, "capture-gaps.json"),
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        gaps: [{ id: "wiring-connector:1", reason: "test" }],
      })
    );
  }

  function baseConfig(root: string, queuePath: string) {
    return {
      root,
      queuePath,
      queueRel: "vehicles.json",
      parallel: 2,
      cookieFile: "templates/cookieString.txt",
      pollSec: 15,
      idleExitMin: 0,
      cookieRefreshMin: 0,
      circuitBreakerThreshold: 2,
      circuitBreakerBackoffSec: 600,
      staleGapAttempts: 10,
      reconcileEveryMin: 60,
      pdfAuditEveryMin: 0,
      pdfAuditSample: 50,
      skipBackfillOnStart: true,
      logDir: path.join(root, "logs"),
      recent403File: path.join(root, "logs/recent-403-stamps.txt"),
      workerLogStaleMs: 1200000,
      workerMaxRuntimeMs: 14400000,
      workerKillGraceMs: 5000,
      pruneOrphanMaxAgeMin: 30,
    };
  }

  it("resolveFinalVehicleStatus matches run_one outcomes", () => {
    expect(resolveFinalVehicleStatus(0, "complete")).toEqual({
      status: "complete",
      success: true,
    });
    expect(resolveFinalVehicleStatus(0, "incomplete")).toEqual({
      status: "incomplete",
      success: false,
    });
    expect(resolveFinalVehicleStatus(1, "incomplete")).toEqual({
      status: "failed",
      success: false,
    });
    expect(resolveFinalVehicleStatus(1, "failed")).toEqual({
      status: "failed",
      success: false,
    });
  });

  it("fixOrphanDownloading patches stuck downloading to complete", () => {
    const root = mkRoot();
    const outputDir = "manuals/orphan-complete";
    mkCompleteManual(root, outputDir);
    const queuePath = writeQueue(root, [
      {
        id: "orphan-v",
        paramsFile: "vehicles/orphan/params.json",
        outputDir,
        status: "downloading",
      },
    ]);
    const config = baseConfig(root, queuePath);
    const patched = fixOrphanDownloading(config, "orphan-v", 0, {
      log: () => {},
    } as never);
    expect(patched).toBe(true);
    const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    expect(q.vehicles[0].status).toBe("complete");
  });

  it("fixOrphanDownloading no-ops when not downloading", () => {
    const root = mkRoot();
    const queuePath = writeQueue(root, [
      {
        id: "done-v",
        outputDir: "manuals/done",
        status: "complete",
      },
    ]);
    const config = baseConfig(root, queuePath);
    expect(
      fixOrphanDownloading(config, "done-v", 1, { log: () => {} } as never)
    ).toBe(false);
  });

  it("circuit breaker trips after threshold auth failures", () => {
    const root = mkRoot();
    const stamps = path.join(root, "logs/stamps.txt");
    const now = Math.floor(Date.now() / 1000);
    fs.writeFileSync(stamps, `${now}\n${now}\n`);
    const config = {
      recent403File: stamps,
      circuitBreakerThreshold: 2,
      circuitBreakerBackoffSec: 120,
    };
    const state = { backoffUntil: 0 };
    const logs: string[] = [];
    expect(
      circuitBreakerBlocksStart(state, config as never, {
        log: (...a: unknown[]) => logs.push(a.join(" ")),
      })
    ).toBe(true);
    expect(state.backoffUntil).toBeGreaterThan(now);
    expect(recentAuthFailureCount(stamps)).toBe(2);
    expect(tripCircuitBreaker(60, () => {})).toBeGreaterThan(now);
  });

  it("idleLimitTicks returns large value when idle exit disabled", () => {
    expect(idleLimitTicks({ idleExitMin: 0, pollSec: 15 } as never)).toBe(
      999_999_999
    );
    expect(idleLimitTicks({ idleExitMin: 30, pollSec: 15 } as never)).toBe(120);
  });

  it("inFlightExcludeCsv joins vehicle ids", () => {
    expect(
      inFlightExcludeCsv([
        { vid: "a", done: false },
        { vid: "b", done: true },
      ] as never)
    ).toBe("a,b");
  });

  it("orchestratorTick runs periodic reconcile only when no workers", async () => {
    const root = mkRoot();
    const queuePath = writeQueue(root, [
      {
        id: "idle-v",
        paramsFile: "vehicles/idle/params.json",
        outputDir: "manuals/idle",
        status: "pending",
      },
    ]);
    const config = baseConfig(root, queuePath);
    config.reconcileEveryMin = 1;
    config.pdfAuditEveryMin = 0;
    config.cookieRefreshMin = 0;

    const reconcileCalls: string[] = [];
    const deps = {
      sleep: async () => {},
      log: () => {},
      nowSec: () => Math.floor(Date.now() / 1000),
      fetch: async () => ({ ok: false }),
      spawn: () => ({ stdout: { pipe: () => {} }, stderr: { pipe: () => {} }, on: () => {} }),
      spawnSync: (cmd: string, args: string[]) => {
        if (args.some((a) => a.includes("reconcile-queue.js"))) {
          reconcileCalls.push("reconcile");
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    };

    const state = {
      failures: 0,
      idleTicks: 0,
      inFlight: [],
      lastCookieRefresh: 0,
      lastReconcile: 0,
      lastPdfAudit: 0,
      backoffUntil: 0,
    };

    await orchestratorTick(config, state, deps as never);
    expect(reconcileCalls).toContain("reconcile");

    reconcileCalls.length = 0;
    state.inFlight = [{ vid: "busy", done: false, exitCode: null }] as never;
    await orchestratorTick(config, state, deps as never);
    expect(reconcileCalls).toHaveLength(0);
  });

  it("runOne spawns yarn with expected flags (mocked)", async () => {
    const root = mkRoot();
    const outputDir = "manuals/run-one";
    const paramsRel = "vehicles/test/params.json";
    fs.mkdirSync(path.dirname(path.join(root, paramsRel)), { recursive: true });
    fs.writeFileSync(path.join(root, paramsRel), "{}");

    const queuePath = writeQueue(root, [
      {
        id: "test-v",
        paramsFile: paramsRel,
        outputDir,
        status: "pending",
      },
    ]);
    const config = baseConfig(root, queuePath);
    config.cookieRefreshMin = 0;

    let yarnArgs: string[] = [];
    const deps = {
      log: () => {},
      nowSec: () => Math.floor(Date.now() / 1000),
      fetch: async () => ({ ok: false }),
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
      spawn: (cmd: string, args: string[]) => {
        if (cmd === "yarn") yarnArgs = args;
        return {
          stdout: { pipe: () => {} },
          stderr: { pipe: () => {} },
          on: (ev: string, fn: (code: number) => void) => {
            if (ev === "close") setTimeout(() => fn(0), 0);
          },
        };
      },
      sleep: async () => {},
    };

    const code = await runOne(
      config,
      {
        v: {
          id: "test-v",
          paramsFile: paramsRel,
          outputDir,
        },
        workshop: true,
        wiring: true,
        stale: false,
      },
      deps as never
    );

    expect(yarnArgs).toContain("-c");
    expect(yarnArgs).toContain(paramsRel);
    expect(yarnArgs).toContain("--noCookieTest");
    expect(yarnArgs).toContain("--ignoreSaveErrors");
    expect(code).toBe(1);
    const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    expect(q.vehicles[0].status).toBe("failed");
  });

  it("reapWorkers counts exit 1 as failure, not exit 2 needs_params", async () => {
    const root = mkRoot();
    const queuePath = writeQueue(root, []);
    const config = baseConfig(root, queuePath);
    const state = {
      failures: 0,
      inFlight: [
        { vid: "a", done: true, exitCode: 1 },
        { vid: "b", done: true, exitCode: 2 },
        { vid: "c", done: true, exitCode: 0 },
      ],
    };
    await reapWorkers(config, state as never, { log: () => {} } as never);
    expect(state.failures).toBe(1);
  });

  it("patchStaleWorkerFromDisk marks incomplete from disk gaps (not failed)", () => {
    const root = mkRoot();
    const outputDir = "manuals/stale-incomplete";
    mkIncompleteManual(root, outputDir);
    const queuePath = writeQueue(root, [
      {
        id: "stale-inc",
        paramsFile: "vehicles/stale/params.json",
        outputDir,
        status: "downloading",
      },
    ]);
    const config = baseConfig(root, queuePath);
    const result = patchStaleWorkerFromDisk(config, "stale-inc", {
      log: () => {},
    } as never);
    expect(result).toEqual({
      patched: true,
      status: "incomplete",
      exitCode: 1,
    });
    const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    expect(q.vehicles[0].status).toBe("incomplete");
  });

  it("patchStaleWorkerFromDisk marks complete when disk verifies", () => {
    const root = mkRoot();
    const outputDir = "manuals/stale-complete";
    mkCompleteManual(root, outputDir);
    const queuePath = writeQueue(root, [
      {
        id: "stale-ok",
        outputDir,
        status: "downloading",
      },
    ]);
    const config = baseConfig(root, queuePath);
    const result = patchStaleWorkerFromDisk(config, "stale-ok", {
      log: () => {},
    } as never);
    expect(result).toEqual({
      patched: true,
      status: "complete",
      exitCode: 0,
    });
    const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    expect(q.vehicles[0].status).toBe("complete");
  });

  it("reapStaleWorkers frees dead-pid slot with disk-truth status", () => {
    const root = mkRoot();
    const outputDir = "manuals/reap-stale";
    mkIncompleteManual(root, outputDir);
    const queuePath = writeQueue(root, [
      {
        id: "dead-worker",
        outputDir,
        status: "downloading",
      },
    ]);
    const config = baseConfig(root, queuePath);
    const state = {
      failures: 0,
      inFlight: [
        {
          vid: "dead-worker",
          done: false,
          exitCode: null,
          pid: 42,
          reaped: false,
          _resolveWorker: null as ((code: number) => void) | null,
        },
      ],
    };
    reapStaleWorkers(config, state as never, {
      log: () => {},
      isProcessAlive: () => false,
    } as never);
    expect(state.inFlight[0].done).toBe(true);
    expect(state.inFlight[0].reaped).toBe(true);
    expect(state.inFlight[0].exitCode).toBe(1);
    const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    expect(q.vehicles[0].status).toBe("incomplete");
  });

  it("runOne returns early when entry.reaped without double markStatus", async () => {
    const root = mkRoot();
    const outputDir = "manuals/reaped-guard";
    const paramsRel = "vehicles/reaped/params.json";
    fs.mkdirSync(path.dirname(path.join(root, paramsRel)), { recursive: true });
    fs.writeFileSync(path.join(root, paramsRel), "{}");
    mkIncompleteManual(root, outputDir);
    const queuePath = writeQueue(root, [
      {
        id: "reaped-v",
        paramsFile: paramsRel,
        outputDir,
        status: "downloading",
      },
    ]);
    const config = baseConfig(root, queuePath);
    config.cookieRefreshMin = 0;

    const entry = {
      vid: "reaped-v",
      done: false,
      exitCode: null as number | null,
      pid: null as number | null,
      reaped: false,
      _resolveWorker: null as ((code: number) => void) | null,
    };

    const deps = {
      log: () => {},
      nowSec: () => Math.floor(Date.now() / 1000),
      fetch: async () => ({ ok: false }),
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
      spawn: (cmd: string, args: string[]) => {
        if (cmd === "yarn") {
          return {
            pid: 999,
            stdout: { pipe: () => {} },
            stderr: { pipe: () => {} },
            on: (ev: string, fn: (code: number) => void) => {
              if (ev === "close") {
                setTimeout(() => {
                  entry.reaped = true;
                  entry.exitCode = 1;
                  fn(0);
                }, 0);
              }
            },
          };
        }
        return {
          stdout: { pipe: () => {} },
          stderr: { pipe: () => {} },
          on: () => {},
        };
      },
      sleep: async () => {},
    };

    const code = await runOne(
      config,
      {
        v: { id: "reaped-v", paramsFile: paramsRel, outputDir },
        workshop: true,
        wiring: true,
        stale: false,
      },
      deps as never,
      null,
      entry as never
    );

    expect(code).toBe(1);
    const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    expect(q.vehicles[0].status).toBe("downloading");
  });

  it("runOne never spawnSyncs prune-cdp-tabs", async () => {
    const root = mkRoot();
    const outputDir = "manuals/no-prune";
    const paramsRel = "vehicles/noprune/params.json";
    fs.mkdirSync(path.dirname(path.join(root, paramsRel)), { recursive: true });
    fs.writeFileSync(path.join(root, paramsRel), "{}");
    const queuePath = writeQueue(root, [
      {
        id: "no-prune-v",
        paramsFile: paramsRel,
        outputDir,
        status: "pending",
      },
    ]);
    const config = baseConfig(root, queuePath);
    config.cookieRefreshMin = 0;

    const spawnSyncCalls: string[][] = [];
    const deps = {
      log: () => {},
      nowSec: () => Math.floor(Date.now() / 1000),
      fetch: async () => ({ ok: false }),
      spawnSync: (_cmd: string, args: string[]) => {
        spawnSyncCalls.push(args);
        return { status: 0, stdout: "", stderr: "" };
      },
      spawn: (cmd: string, _args: string[]) => ({
        pid: 1001,
        stdout: { pipe: () => {} },
        stderr: { pipe: () => {} },
        on: (ev: string, fn: (code: number) => void) => {
          if (cmd === "yarn" && ev === "close") setTimeout(() => fn(0), 0);
        },
      }),
      sleep: async () => {},
    };

    await runOne(
      config,
      {
        v: { id: "no-prune-v", paramsFile: paramsRel, outputDir },
        workshop: true,
        wiring: true,
        stale: false,
      },
      deps as never
    );

    const pruneCalls = spawnSyncCalls.filter((args) =>
      args.some((a) => String(a).includes("prune-cdp-tabs"))
    );
    expect(pruneCalls).toHaveLength(0);
  });

  it("reapHungWorkers kills alive worker with stale log and patches incomplete", async () => {
    const root = mkRoot();
    const outputDir = "manuals/hung-stale";
    mkIncompleteManual(root, outputDir);
    const logPath = path.join(root, "logs/hung-v.log");
    const staleTime = Date.now() - 30 * 60 * 1000;
    fs.writeFileSync(logPath, "stale log\n");
    fs.utimesSync(logPath, staleTime / 1000, staleTime / 1000);

    const queuePath = writeQueue(root, [
      {
        id: "hung-v",
        outputDir,
        status: "downloading",
      },
    ]);
    const config = {
      ...baseConfig(root, queuePath),
      workerLogStaleMs: 60_000,
      workerMaxRuntimeMs: 0,
      workerKillGraceMs: 0,
    };
    const state = {
      failures: 0,
      inFlight: [
        {
          vid: "hung-v",
          done: false,
          exitCode: null,
          pid: 4242,
          reaped: false,
          startedAt: Date.now() - 1000,
          logPath,
          _resolveWorker: null as ((code: number) => void) | null,
        },
      ],
      idleTicks: 0,
      lastCookieRefresh: 0,
      lastReconcile: 0,
      lastPdfAudit: 0,
      backoffUntil: 0,
      shutdownRequested: false,
    };

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    await reapHungWorkers(config, state as never, {
      log: () => {},
      sleep: async () => {},
      isProcessAlive: () => true,
      statSync: (p: string) => fs.statSync(p),
    } as never);

    expect(killSpy).toHaveBeenCalled();
    killSpy.mockRestore();
    expect(state.inFlight[0].done).toBe(true);
    expect(state.inFlight[0].reaped).toBe(true);
    const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    expect(q.vehicles[0].status).toBe("incomplete");
  });

  it("reapHungWorkers reaps pre-spawn entry on max runtime without pid", async () => {
    const root = mkRoot();
    const outputDir = "manuals/pre-spawn";
    mkIncompleteManual(root, outputDir);
    const queuePath = writeQueue(root, [
      {
        id: "pre-v",
        outputDir,
        status: "downloading",
      },
    ]);
    const config = {
      ...baseConfig(root, queuePath),
      workerLogStaleMs: 0,
      workerMaxRuntimeMs: 1000,
      workerKillGraceMs: 0,
    };
    const state = {
      failures: 0,
      inFlight: [
        {
          vid: "pre-v",
          done: false,
          exitCode: null,
          pid: null,
          reaped: false,
          startedAt: Date.now() - 5000,
          logPath: path.join(root, "logs/pre-v.log"),
          _resolveWorker: null as ((code: number) => void) | null,
        },
      ],
    };

    await reapHungWorkers(config, state as never, {
      log: () => {},
      sleep: async () => {},
      isProcessAlive: () => false,
    } as never);

    expect(state.inFlight[0].done).toBe(true);
    expect(state.inFlight[0].reaped).toBe(true);
    const q = JSON.parse(fs.readFileSync(queuePath, "utf8"));
    expect(q.vehicles[0].status).toBe("incomplete");
  });

  it("reapHungWorkers runs before reapStaleWorkers on dead pid", async () => {
    const root = mkRoot();
    const outputDir = "manuals/reap-order";
    mkIncompleteManual(root, outputDir);
    const queuePath = writeQueue(root, [
      { id: "order-v", outputDir, status: "downloading" },
    ]);
    const config = {
      ...baseConfig(root, queuePath),
      workerLogStaleMs: 0,
      workerMaxRuntimeMs: 1000,
      workerKillGraceMs: 0,
    };
    const entry = {
      vid: "order-v",
      done: false,
      exitCode: null,
      pid: 77,
      reaped: false,
      startedAt: Date.now() - 5000,
      logPath: path.join(root, "logs/order-v.log"),
      _resolveWorker: null as ((code: number) => void) | null,
    };
    const state = { failures: 0, inFlight: [entry] };

    await reapHungWorkers(config, state as never, {
      log: () => {},
      sleep: async () => {},
      isProcessAlive: () => false,
    } as never);
    expect(entry.reaped).toBe(true);

    reapStaleWorkers(config, state as never, {
      log: () => {},
      isProcessAlive: () => false,
    } as never);
    expect(entry.done).toBe(true);
  });

  it("logHeartbeat emits inFlight summary", () => {
    const root = mkRoot();
    const queuePath = writeQueue(root, []);
    const config = baseConfig(root, queuePath);
    const logLines: string[] = [];
    const state = {
      inFlight: [
        {
          vid: "hb-v",
          pid: 12,
          startedAt: Date.now() - 10_000,
          logPath: path.join(root, "logs/hb-v.log"),
        },
      ],
    };
    fs.writeFileSync(state.inFlight[0].logPath, "x\n");
    logHeartbeat(config, state as never, {
      log: (...args: unknown[]) => logLines.push(args.join(" ")),
      statSync: (p: string) => fs.statSync(p),
    } as never);
    expect(logLines.some((l) => l.includes("[heartbeat]"))).toBe(true);
    expect(logLines.some((l) => l.includes("hb-v"))).toBe(true);
  });

  it("runOne skips yarn spawn when entry.reaped after refreshCookies", async () => {
    const root = mkRoot();
    const outputDir = "manuals/pre-reaped-guard";
    const paramsRel = "vehicles/pre-reaped/params.json";
    fs.mkdirSync(path.dirname(path.join(root, paramsRel)), { recursive: true });
    fs.writeFileSync(path.join(root, paramsRel), "{}");
    mkIncompleteManual(root, outputDir);
    const queuePath = writeQueue(root, [
      {
        id: "pre-reaped-v",
        paramsFile: paramsRel,
        outputDir,
        status: "pending",
      },
    ]);
    const config = baseConfig(root, queuePath);
    config.cookieRefreshMin = 0;

    let yarnSpawned = false;
    const entry = {
      vid: "pre-reaped-v",
      done: false,
      exitCode: 1,
      pid: null,
      reaped: true,
      startedAt: Date.now(),
      logPath: path.join(root, "logs/pre-reaped-v.log"),
      _resolveWorker: null as ((code: number) => void) | null,
    };

    const deps = {
      log: () => {},
      nowSec: () => Math.floor(Date.now() / 1000),
      fetch: async () => ({ ok: false }),
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
      spawn: (cmd: string) => {
        if (cmd === "yarn") yarnSpawned = true;
        return {
          pid: 1002,
          stdout: { pipe: () => {} },
          stderr: { pipe: () => {} },
          on: () => {},
        };
      },
      sleep: async () => {},
    };

    const code = await runOne(
      config,
      {
        v: { id: "pre-reaped-v", paramsFile: paramsRel, outputDir },
        workshop: true,
        wiring: true,
        stale: false,
      },
      deps as never,
      null,
      entry as never
    );

    expect(code).toBe(1);
    expect(yarnSpawned).toBe(false);
  });

  it("getVehicleLogMtime returns null for missing log", () => {
    const root = mkRoot();
    expect(
      getVehicleLogMtime(path.join(root, "logs/missing.log"), {
        statSync: (p: string) => fs.statSync(p),
      } as never)
    ).toBeNull();
  });
});

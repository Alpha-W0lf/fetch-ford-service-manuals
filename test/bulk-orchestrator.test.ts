import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  circuitBreakerBlocksStart,
  fixOrphanDownloading,
  idleLimitTicks,
  inFlightExcludeCsv,
  orchestratorTick,
  resolveFinalVehicleStatus,
  runOne,
  reapWorkers,
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
});

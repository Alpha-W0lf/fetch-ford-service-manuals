import { describe, expect, it } from "vitest";
import {
  collectProtectedPids,
  listOrphanPrunePids,
  parseEtimeMinutes,
} from "../lib/orphan-prune-reaper.js";

describe("orphan-prune-reaper", () => {
  it("parseEtimeMinutes handles MM:SS and HH:MM:SS", () => {
    expect(parseEtimeMinutes("05:30")).toBeCloseTo(5.5);
    expect(parseEtimeMinutes("01:15:00")).toBeCloseTo(75);
    expect(parseEtimeMinutes("1-02:30:00")).toBeCloseTo(24 * 60 + 150);
  });

  it("collectProtectedPids includes descendants of orchestrator", () => {
    const rows = [
      { pid: 100, ppid: 1 },
      { pid: 200, ppid: 100 },
      { pid: 300, ppid: 200 },
      { pid: 900, ppid: 1 },
    ];
    const protectedSet = collectProtectedPids([100], rows);
    expect(protectedSet.has(100)).toBe(true);
    expect(protectedSet.has(200)).toBe(true);
    expect(protectedSet.has(300)).toBe(true);
    expect(protectedSet.has(900)).toBe(false);
  });

  it("listOrphanPrunePids returns stale prune not under protected tree", () => {
    const psOutput = `  PID  PPID     ELAPSED COMMAND
  100     1       00:05 node scripts/bulk-orchestrator.js
  200   100       45:00 npm exec ts-node scripts/prune-cdp-tabs.ts
  300     1     1-02:00:00 ts-node scripts/prune-cdp-tabs.ts
  400   100       00:10 yarn start
`;
    const deps = {
      spawnSync: () => ({ status: 0, stdout: psOutput }),
    };
    const orphans = listOrphanPrunePids(100, [400], 30, deps);
    expect(orphans).toEqual([300]);
  });

  it("listOrphanPrunePids excludes prune under in-flight worker", () => {
    const psOutput = `  PID  PPID     ELAPSED COMMAND
  100     1       00:05 node scripts/bulk-orchestrator.js
  400   100       00:10 yarn start
  500   400     1-02:00:00 ts-node scripts/prune-cdp-tabs.ts
`;
    const deps = {
      spawnSync: () => ({ status: 0, stdout: psOutput }),
    };
    const orphans = listOrphanPrunePids(100, [400], 30, deps);
    expect(orphans).toEqual([]);
  });
});

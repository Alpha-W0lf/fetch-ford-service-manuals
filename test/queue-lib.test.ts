import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { isQueued, queueRank, sortQueued } from "../scripts/queue-lib";

describe("queue-lib", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tmpRoots.length = 0;
  });

  function mkRootWithGaps(gaps: unknown[]): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-queue-"));
    tmpRoots.push(root);
    const outputDir = "manuals/test-vehicle";
    const full = path.join(root, outputDir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(
      path.join(full, "capture-gaps.json"),
      JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), gaps })
    );
    return root;
  }

  it("isQueued excludes needs_params", () => {
    const root = mkRootWithGaps([]);
    expect(isQueued({ status: "needs_params", outputDir: "x" }, root)).toBe(
      false
    );
    expect(isQueued({ status: "pending", outputDir: "x" }, root)).toBe(true);
  });

  it("queueRank prioritizes fresh incomplete tier 1 over tier 2", () => {
    const root = mkRootWithGaps([
      {
        id: "g1",
        source: "connector-audit",
        expectedFile: "a.pdf",
        attempts: 1,
      },
    ]);
    const tier1 = {
      status: "incomplete",
      tier: 1,
      outputDir: "manuals/test-vehicle",
    };
    const tier2 = {
      status: "incomplete",
      tier: 2,
      outputDir: "manuals/test-vehicle",
    };
    expect(queueRank(tier1, root)).toBeLessThan(queueRank(tier2, root));
  });

  it("sortQueued orders by rank then tier then priority", () => {
    const root = mkRootWithGaps([]);
    const vehicles = [
      {
        id: "b",
        status: "pending",
        tier: 2,
        priority: 1,
        outputDir: "manuals/b",
      },
      {
        id: "a",
        status: "incomplete",
        tier: 1,
        priority: 9,
        outputDir: "manuals/test-vehicle",
      },
    ];
    const sorted = sortQueued(vehicles, root);
    expect(sorted[0].id).toBe("a");
  });
});

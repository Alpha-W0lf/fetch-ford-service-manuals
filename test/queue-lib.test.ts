import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isQueued,
  isStaleIncomplete,
  isStaleIncompleteFromGaps,
  queueRank,
  sortQueued,
  STALE_GAP_ATTEMPTS,
} from "../scripts/queue-lib";

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

  const blockingGap = (attempts: number) => ({
    id: "g1",
    section: "workshop",
    name: "Missing",
    relativePath: "x",
    expectedFile: "Workshop/x.pdf",
    reason: "network",
    error: "fail",
    attempts,
    lastAttemptAt: new Date().toISOString(),
  });

  it("isQueued excludes needs_params", () => {
    const root = mkRootWithGaps([]);
    expect(isQueued({ status: "needs_params", outputDir: "x" }, root)).toBe(
      false
    );
    expect(isQueued({ status: "pending", outputDir: "x" }, root)).toBe(true);
  });

  it("isStaleIncompleteFromGaps false when no blocking gaps", () => {
    expect(isStaleIncompleteFromGaps([])).toBe(false);
    expect(
      isStaleIncompleteFromGaps([
        { source: "toc-audit", expectedFile: "x.pdf", attempts: 99 },
      ])
    ).toBe(false);
  });

  it("isStaleIncompleteFromGaps false when blocking gaps under attempt threshold", () => {
    const gaps = [blockingGap(STALE_GAP_ATTEMPTS - 1)];
    expect(isStaleIncompleteFromGaps(gaps)).toBe(false);
  });

  it("isStaleIncompleteFromGaps true when all blocking gaps exhausted", () => {
    const gaps = [
      blockingGap(STALE_GAP_ATTEMPTS),
      blockingGap(STALE_GAP_ATTEMPTS + 2),
    ];
    expect(isStaleIncompleteFromGaps(gaps)).toBe(true);
  });

  it("isStaleIncomplete reads gaps from disk", () => {
    const root = mkRootWithGaps([blockingGap(STALE_GAP_ATTEMPTS)]);
    expect(
      isStaleIncomplete(root, "manuals/test-vehicle")
    ).toBe(true);
  });

  it("queueRank deprioritizes stale incomplete vs fresh incomplete", () => {
    const staleRoot = mkRootWithGaps([blockingGap(STALE_GAP_ATTEMPTS)]);
    const freshRoot = mkRootWithGaps([blockingGap(1)]);
    const staleVehicle = {
      status: "incomplete",
      tier: 2,
      outputDir: "manuals/test-vehicle",
    };
    const freshVehicle = {
      status: "incomplete",
      tier: 2,
      outputDir: "manuals/test-vehicle",
    };
    expect(queueRank(freshVehicle, freshRoot)).toBeLessThan(
      queueRank(staleVehicle, staleRoot)
    );
  });

  it("queueRank prioritizes fresh incomplete tier 1 over tier 2", () => {
    const root = mkRootWithGaps([blockingGap(1)]);
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

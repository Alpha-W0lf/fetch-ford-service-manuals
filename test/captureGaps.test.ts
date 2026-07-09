import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import CaptureGaps from "../src/captureGaps";
import {
  hasQueueBlockingGaps,
  queueBlockingGapCount,
} from "../lib/capture-gaps-rules.js";
import fixture from "./fixtures/minimal-capture-gaps.json";

describe("captureGaps TS parity with lib/capture-gaps-rules", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function loadGaps(gaps: unknown[]): Promise<CaptureGaps> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ford-capture-gaps-"));
    tmpDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "capture-gaps.json"),
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        gaps,
      })
    );
    return CaptureGaps.load(dir);
  }

  it("hasBlockingGaps and blockingCount match lib rules for fixture", async () => {
    const cg = await loadGaps(fixture.gaps);
    expect(cg.hasBlockingGaps()).toBe(hasQueueBlockingGaps(fixture.gaps));
    expect(cg.blockingCount()).toBe(queueBlockingGapCount(fixture.gaps));
  });

  it("orphan log-backfill alone does not block", async () => {
    const gaps = [
      {
        id: "log-orphan",
        section: "workshop" as const,
        name: "Log",
        relativePath: "",
        expectedFile: "",
        reason: "error",
        error: "from log",
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
        source: "log-backfill",
        docId: "DOC",
      },
    ];
    const cg = await loadGaps(gaps);
    expect(cg.hasBlockingGaps()).toBe(false);
    expect(cg.blockingCount()).toBe(0);
  });
});

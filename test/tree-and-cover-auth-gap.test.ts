import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaptureGaps from "../src/captureGaps";

const { fetchTreeAndCover } = vi.hoisted(() => ({
  fetchTreeAndCover: vi.fn(),
}));

vi.mock("../src/workshop/fetchTreeAndCover", () => ({
  default: fetchTreeAndCover,
}));
vi.mock("../src/workshop/saveEntireManual", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

import { modernWorkshop } from "../src/jobHelpers";
import saveEntireManual from "../src/workshop/saveEntireManual";

describe("TreeAndCover auth gap", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("records workshop:tree-and-cover gap and returns without throw", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-tree-cover-"));
    tmpDirs.push(root);
    const captureGaps = await CaptureGaps.load(root);
    fetchTreeAndCover.mockRejectedValue(new Error("HTTP 403 Access Denied"));

    const config = {
      workshop: {
        modelYear: "2020",
        CategoryDescription: "GSIXML",
        category: "33",
      },
    } as never;

    await expect(
      modernWorkshop(config, root, {} as never, {
        outputRoot: root,
        saveHTML: false,
        ignoreSaveErrors: true,
        captureGaps,
      })
    ).resolves.toBeUndefined();

    expect(saveEntireManual).not.toHaveBeenCalled();
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "capture-gaps.json"), "utf8")
    );
    expect(
      raw.gaps.some((g: { id: string }) => g.id === "workshop:tree-and-cover")
    ).toBe(true);
  });

  it("rethrows non-auth TreeAndCover failures", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-tree-cover-"));
    tmpDirs.push(root);
    const captureGaps = await CaptureGaps.load(root);
    fetchTreeAndCover.mockRejectedValue(new Error("ECONNRESET"));

    const config = {
      workshop: {
        modelYear: "2020",
        CategoryDescription: "GSIXML",
        category: "33",
      },
    } as never;

    await expect(
      modernWorkshop(config, root, {} as never, {
        outputRoot: root,
        saveHTML: false,
        ignoreSaveErrors: true,
        captureGaps,
      })
    ).rejects.toThrow("ECONNRESET");

    expect(saveEntireManual).not.toHaveBeenCalled();
  });
});

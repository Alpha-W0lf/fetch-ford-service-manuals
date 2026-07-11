import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaptureGaps from "../src/captureGaps";

const { fetchTableOfContents } = vi.hoisted(() => ({
  fetchTableOfContents: vi.fn(),
}));

vi.mock("../src/wiring/fetchTableOfContents", () => ({
  default: fetchTableOfContents,
}));

import { resolveWiringTableOfContents } from "../src/jobHelpers";

describe("wiring TOC auth gap", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("records wiring-page:toc gap and returns null without throwing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-wiring-toc-"));
    tmpDirs.push(root);
    const captureGaps = await CaptureGaps.load(root);
    fetchTableOfContents.mockRejectedValue(new Error("HTTP 403 Access Denied"));

    const wiringParams = {
      book: "BK1",
      bookType: "wiring",
      country: "US",
      environment: "prod",
      contentmarket: "US",
      contentlanguage: "EN",
      languageCode: "EN",
    } as never;

    const result = await resolveWiringTableOfContents(
      wiringParams,
      captureGaps
    );

    expect(result).toBeNull();
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "capture-gaps.json"), "utf8")
    );
    expect(
      raw.gaps.some((g: { id: string }) => g.id === "wiring-page:toc:BK1")
    ).toBe(true);
  });

  it("rethrows non-auth wiring TOC failures", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-wiring-toc-"));
    tmpDirs.push(root);
    const captureGaps = await CaptureGaps.load(root);
    fetchTableOfContents.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      resolveWiringTableOfContents(
        { book: "BK2" } as never,
        captureGaps
      )
    ).rejects.toThrow("ECONNRESET");
  });
});

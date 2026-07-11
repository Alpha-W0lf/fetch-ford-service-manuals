import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
import CaptureGaps from "../src/captureGaps";

const { fetchManualPage } = vi.hoisted(() => ({
  fetchManualPage: vi.fn(),
}));

vi.mock("../src/workshop/fetchManualPage", () => ({
  default: fetchManualPage,
}));
vi.mock("../src/renderHtmlToPdf", () => ({
  renderWorkshopPageToPdf: vi.fn().mockResolvedValue(undefined),
}));

import saveEntireManual from "../src/workshop/saveEntireManual";

describe("workshop log redaction", () => {
  const tmpDirs: string[] = [];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.clearAllMocks();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("does not log raw Cookie headers from axios failures", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-log-redact-"));
    tmpDirs.push(root);
    const captureGaps = await CaptureGaps.load(root);

    const err = new AxiosError(
      "Request failed with status code 403",
      "ERR_BAD_REQUEST",
      {
        headers: { Cookie: "session=super-secret-cookie-value" },
        method: "get",
        url: "https://example.test/page",
      } as never,
      {},
      {
        status: 403,
        statusText: "Forbidden",
        data: "Access Denied",
        headers: {},
        config: {} as never,
      }
    );
    fetchManualPage.mockRejectedValue(err);

    await saveEntireManual(
      root,
      { "Page A": "DOC1" },
      { vehicleId: "VIN1", country: "US", searchNumber: "1" } as never,
      {} as never,
      {
        outputRoot: root,
        saveHTML: false,
        ignoreSaveErrors: true,
        captureGaps,
      }
    );

    const combined = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(combined).not.toContain("super-secret-cookie-value");
    expect(combined).not.toContain("session=");
    expect(combined).toContain("403");
  });
});

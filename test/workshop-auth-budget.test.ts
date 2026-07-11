import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import saveEntireManual, { SaveOptions } from "../src/workshop/saveEntireManual";

describe("workshop auth budget stop", () => {
  const tmpDirs: string[] = [];
  const browserPage = {} as import("playwright").Page;
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    vi.stubEnv("WORKSHOP_AUTH_STOP_THRESHOLD", "3");
    vi.stubEnv("WORKSHOP_AUTH_REFRESH_THRESHOLD", "2");
    vi.stubEnv("WORKSHOP_AUTH_STOP_ENABLED", "1");
    fetchManualPage.mockRejectedValue(new Error("HTTP 403 Access Denied"));
  });

  afterEach(() => {
    logSpy.mockClear();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  async function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-workshop-budget-"));
    tmpDirs.push(root);
    const captureGaps = await CaptureGaps.load(root);
    return { root, captureGaps };
  }

  const baseParams = {
    vehicleId: "VIN1",
    country: "US",
    searchNumber: "1",
  } as never;

  it("stops after consecutive auth failures and logs auth-budget-stop", async () => {
    const { root, captureGaps } = await setup();
    const options: SaveOptions = {
      outputRoot: root,
      saveHTML: false,
      ignoreSaveErrors: true,
      captureGaps,
    };

    await saveEntireManual(
      root,
      { "Page A": "DOC1", "Page B": "DOC2", "Page C": "DOC3", "Page D": "DOC4" },
      baseParams,
      browserPage,
      options
    );

    expect(options).toHaveProperty("authBudgetStopRequested", true);
    expect(
      logSpy.mock.calls.some((c) =>
        String(c[0]).includes("[auth-budget-stop]")
      )
    ).toBe(true);
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "capture-gaps.json"), "utf8")
    );
    expect(raw.gaps.length).toBe(3);
  });

  it("counts subscription-expired toward the auth budget", async () => {
    vi.stubEnv("WORKSHOP_AUTH_STOP_THRESHOLD", "2");
    vi.stubEnv("WORKSHOP_AUTH_REFRESH_THRESHOLD", "1");
    fetchManualPage.mockRejectedValue(
      new Error("PTS auth redirect subscriptionExpired")
    );
    const { root, captureGaps } = await setup();

    await saveEntireManual(
      root,
      { "Page A": "DOC1", "Page B": "DOC2" },
      baseParams,
      browserPage,
      {
        outputRoot: root,
        saveHTML: false,
        ignoreSaveErrors: true,
        captureGaps,
      }
    );

    expect(
      logSpy.mock.calls.some((c) =>
        String(c[0]).includes("[auth-budget-stop]")
      )
    ).toBe(true);
  });

  it("propagates authBudgetStopRequested from nested TOC folders", async () => {
    vi.stubEnv("WORKSHOP_AUTH_STOP_THRESHOLD", "2");
    vi.stubEnv("WORKSHOP_AUTH_REFRESH_THRESHOLD", "1");
    const { root, captureGaps } = await setup();
    const options: SaveOptions = {
      outputRoot: root,
      saveHTML: false,
      ignoreSaveErrors: true,
      captureGaps,
    };

    await saveEntireManual(
      root,
      {
        "Folder": { "Inner Page": "INNER1", "Inner Two": "INNER2" },
        "Outer Page": "OUTER1",
      },
      baseParams,
      browserPage,
      options
    );

    expect(options.authBudgetStopRequested).toBe(true);
    expect(fetchManualPage).toHaveBeenCalledTimes(2);
  });

  it("does not stop on network failures", async () => {
    fetchManualPage.mockRejectedValue(new Error("ECONNRESET"));
    const { root, captureGaps } = await setup();
    const options: SaveOptions = {
      outputRoot: root,
      saveHTML: false,
      ignoreSaveErrors: true,
      captureGaps,
    };

    await saveEntireManual(
      root,
      { "Page A": "DOC1", "Page B": "DOC2", "Page C": "DOC3" },
      baseParams,
      browserPage,
      options
    );

    expect(options.authBudgetStopRequested).toBeFalsy();
    expect(
      logSpy.mock.calls.some((c) =>
        String(c[0]).includes("[auth-budget-stop]")
      )
    ).toBe(false);
  });
});

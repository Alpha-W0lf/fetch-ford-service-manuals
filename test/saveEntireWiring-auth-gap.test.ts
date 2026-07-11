import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CaptureGaps from "../src/captureGaps";
import { PtsAuthError } from "../src/ptsAuth";

const {
  savePage,
  saveConnector,
  saveLocIndex,
  probeConnectorAccess,
  createConnectorPage,
} = vi.hoisted(() => ({
  savePage: vi.fn(),
  saveConnector: vi.fn(),
  saveLocIndex: vi.fn(),
  probeConnectorAccess: vi.fn(),
  createConnectorPage: vi.fn(),
}));

vi.mock("../src/wiring/savePage", () => ({ default: savePage }));
vi.mock("../src/wiring/saveConnector", () => ({ default: saveConnector }));
vi.mock("../src/wiring/saveLocIndex", () => ({ saveLocIndex }));
vi.mock("../src/ptsAuth", async () => {
  const actual = await vi.importActual<typeof import("../src/ptsAuth")>(
    "../src/ptsAuth"
  );
  return {
    ...actual,
    probeConnectorAccess,
  };
});
vi.mock("../src/cdpConnectorPage", () => ({ createConnectorPage }));
vi.mock("../src/connectorProbeUrl", () => ({
  getConnectorProbeUrl: () => "https://example.test/probe",
}));

import saveEntireWiring from "../src/wiring/saveEntireWiring";

describe("saveEntireWiring auth gap accounting", () => {
  const tmpDirs: string[] = [];
  const browserPage = {
    context: () => ({}),
  } as unknown as import("playwright").Page;

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  beforeEach(() => {
    createConnectorPage.mockResolvedValue({
      page: browserPage,
      close: async () => {},
      usesCdp: false,
    });
  });

  async function setup(outputDir: string) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ford-wiring-gap-"));
    tmpDirs.push(projectRoot);
    const root = path.join(projectRoot, outputDir);
    fs.mkdirSync(root, { recursive: true });
    const captureGaps = await CaptureGaps.load(root);
    return { projectRoot, root, captureGaps };
  }

  const baseParams = {
    vehicleId: "VIN1",
    country: "US",
    environment: "prod",
    book: "BK",
    bookType: "wiring",
    contentmarket: "US",
    contentlanguage: "EN",
    languageCode: "EN",
  };

  it("records probe gap when connector portal probe fails with auth", async () => {
    const { root, captureGaps } = await setup("manuals/probe-gap");
    probeConnectorAccess.mockRejectedValue(
      new PtsAuthError("probe failed", "subscription-expired")
    );

    await saveEntireWiring(
      root,
      baseParams as never,
      baseParams as never,
      [
        {
          Type: "Connectors",
          Number: "C1",
          Maintitle: "Conn",
          Page: "1",
          Title: "Connector Section",
          Filename: "c1",
        },
      ],
      browserPage,
      true,
      captureGaps,
      { refreshCookies: async () => {} }
    );

    const gaps = (await CaptureGaps.load(root)).blockingCount();
    expect(gaps).toBeGreaterThan(0);
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "capture-gaps.json"), "utf8")
    );
    expect(
      raw.gaps.some(
        (g: { id: string }) => g.id === "wiring-connector:C1:__probe__"
      )
    ).toBe(true);
    expect(saveConnector).not.toHaveBeenCalled();
  });

  it("records auth-streak gap when connector capture fails after portal probe", async () => {
    const { root, captureGaps } = await setup("manuals/auth-streak");
    probeConnectorAccess.mockResolvedValue(undefined);
    saveConnector.mockRejectedValue(
      new PtsAuthError("connector auth streak", "subscription-expired")
    );

    await saveEntireWiring(
      root,
      baseParams as never,
      baseParams as never,
      [
        {
          Type: "Connectors",
          Number: "C3",
          Maintitle: "Conn",
          Page: "1",
          Title: "Connector Section",
          Filename: "c3",
        },
      ],
      browserPage,
      true,
      captureGaps,
      { refreshCookies: async () => {} }
    );

    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "capture-gaps.json"), "utf8")
    );
    expect(
      raw.gaps.some(
        (g: { id: string }) => g.id === "wiring-connector:C3:__auth-streak__"
      )
    ).toBe(true);
    expect(
      raw.gaps.some(
        (g: { id: string }) => g.id === "wiring-connector:C3:__probe__"
      )
    ).toBe(false);
  });

  it("increments probe gap attempts toward stale-incomplete threshold", async () => {
    const outputDir = "manuals/probe-attempts";
    const { projectRoot, root, captureGaps } = await setup(outputDir);
    probeConnectorAccess.mockRejectedValue(
      new PtsAuthError("probe failed", "auth")
    );

    for (let i = 0; i < 10; i++) {
      await saveEntireWiring(
        root,
        baseParams as never,
        baseParams as never,
        [
          {
            Type: "Connectors",
            Number: "C1",
            Maintitle: "Conn",
            Page: "1",
            Title: "Connector Section",
            Filename: "c1",
          },
        ],
        browserPage,
        true,
        captureGaps,
        { refreshCookies: async () => {} }
      );
    }

    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "capture-gaps.json"), "utf8")
    );
    const probeGap = raw.gaps.find(
      (g: { id: string }) => g.id === "wiring-connector:C1:__probe__"
    );
    expect(probeGap?.attempts).toBe(10);

    const { isStaleIncomplete } = await import("../scripts/queue-lib.js");
    expect(isStaleIncomplete(projectRoot, outputDir)).toBe(true);
  });

  it("re-probes connector portal after an earlier probe failure in the same run", async () => {
    const { root, captureGaps } = await setup("manuals/probe-retry");
    probeConnectorAccess
      .mockRejectedValueOnce(new PtsAuthError("probe failed", "auth"))
      .mockResolvedValueOnce(undefined);
    saveConnector.mockResolvedValue(undefined);

    const connectorsToc = [
      {
        Type: "Connectors",
        Number: "C1",
        Maintitle: "Conn",
        Page: "1",
        Title: "Connector Section A",
        Filename: "c1",
      },
      {
        Type: "Connectors",
        Number: "C2",
        Maintitle: "Conn",
        Page: "2",
        Title: "Connector Section B",
        Filename: "c2",
      },
    ] as const;

    await saveEntireWiring(
      root,
      baseParams as never,
      baseParams as never,
      [...connectorsToc],
      browserPage,
      true,
      captureGaps,
      { refreshCookies: async () => {} }
    );

    expect(createConnectorPage).toHaveBeenCalledTimes(2);
    expect(probeConnectorAccess).toHaveBeenCalledTimes(2);
    expect(saveConnector).toHaveBeenCalledTimes(1);
  });

  it("records loc-index gap on LocIndex auth failure without duplicating page gaps", async () => {
    const { root, captureGaps } = await setup("manuals/loc-gap");
    saveLocIndex.mockRejectedValue(new Error("HTTP 403 Access Denied"));

    await saveEntireWiring(
      root,
      baseParams as never,
      baseParams as never,
      [
        {
          Type: "LocIndex",
          Number: "C2",
          Maintitle: "Loc",
          Page: "2",
          Title: "Location Index",
          Filename: "loc",
        },
      ],
      browserPage,
      true,
      captureGaps
    );

    const raw = JSON.parse(
      fs.readFileSync(path.join(root, "capture-gaps.json"), "utf8")
    );
    expect(
      raw.gaps.some(
        (g: { id: string }) => g.id === "wiring-page:C2:loc-index"
      )
    ).toBe(true);
    expect(savePage).not.toHaveBeenCalled();
  });

  it("does not add outer auth gap for ordinary page failures (savePage owns them)", async () => {
    const { root, captureGaps } = await setup("manuals/page-gap");
    savePage.mockRejectedValue(new Error("HTTP 403 Access Denied"));

    await saveEntireWiring(
      root,
      baseParams as never,
      baseParams as never,
      [
        {
          Type: "Page",
          Number: "P1",
          Maintitle: "Pg",
          Page: "3",
          Title: "Diagram",
          Filename: "p1",
        },
      ],
      browserPage,
      true,
      captureGaps
    );

    const file = path.join(root, "capture-gaps.json");
    expect(fs.existsSync(file)).toBe(false);
  });
});

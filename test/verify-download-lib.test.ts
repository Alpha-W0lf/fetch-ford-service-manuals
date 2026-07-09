import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDownload } from "../scripts/verify-download-lib";

describe("verify-download-lib", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tmpRoots.length = 0;
  });

  function writeMinimalPdfs(dir: string, count: number): void {
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < count; i++) {
      fs.writeFileSync(path.join(dir, `doc-${i}.pdf`), `%PDF-${i}\n`);
    }
  }

  function mkCompleteManual(root: string, outputDir: string): string {
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
      JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), gaps: [] })
    );
    return full;
  }

  function mkRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-verify-"));
    tmpRoots.push(root);
    return root;
  }

  it("complete manual passes verify", () => {
    const root = mkRoot();
    const outputDir = "manuals/complete-vehicle";
    mkCompleteManual(root, outputDir);
    expect(verifyDownload(root, outputDir)).toEqual({
      ok: true,
      pdfs: 55,
      gaps: 0,
    });
  });

  it("too few PDFs fails", () => {
    const root = mkRoot();
    const outputDir = "manuals/thin-vehicle";
    const full = path.join(root, outputDir);
    writeMinimalPdfs(full, 10);
    fs.writeFileSync(path.join(full, "cover.html"), "<html></html>");
    fs.writeFileSync(
      path.join(full, "capture-gaps.json"),
      JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), gaps: [] })
    );
    const result = verifyDownload(root, outputDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/too few PDFs/);
  });

  it("blocking capture gaps fail verify", () => {
    const root = mkRoot();
    const outputDir = "manuals/gappy-vehicle";
    mkCompleteManual(root, outputDir);
    const gapsPath = path.join(root, outputDir, "capture-gaps.json");
    fs.writeFileSync(
      gapsPath,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        gaps: [
          {
            id: "runtime-1",
            section: "workshop",
            name: "Missing",
            relativePath: "x",
            expectedFile: "Workshop/x/missing.pdf",
            reason: "network",
            error: "fail",
            attempts: 1,
            lastAttemptAt: new Date().toISOString(),
          },
        ],
      })
    );
    const result = verifyDownload(root, outputDir);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/capture gaps/);
  });

  it("orphan log-backfill does not block verify", () => {
    const root = mkRoot();
    const outputDir = "manuals/hybrid-vehicle";
    mkCompleteManual(root, outputDir);
    const gapsPath = path.join(root, outputDir, "capture-gaps.json");
    fs.writeFileSync(
      gapsPath,
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        gaps: [
          {
            id: "log-orphan",
            section: "workshop",
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
        ],
      })
    );
    expect(verifyDownload(root, outputDir).ok).toBe(true);
  });
});

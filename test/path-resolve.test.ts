import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildExistingPathIndex,
  fileExistsForGap,
  pathColonDashVariants,
  resolveExistingSubdir,
  statNonEmptyFile,
} from "../lib/path-resolve.js";

describe("path-resolve", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  function mkTmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ford-path-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("pathColonDashVariants includes colon and dash forms", () => {
    const rel = "Workshop/1- General Information/doc.pdf";
    const variants = pathColonDashVariants(rel);
    expect(variants).toContain(rel);
    expect(variants).toContain("Workshop/1: General Information/doc.pdf");
  });

  it("fileExistsForGap finds file via dash variant", () => {
    const root = mkTmp();
    const dir = path.join(root, "Workshop", "1- General Information");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "doc.pdf");
    fs.writeFileSync(file, "%PDF-1.4 minimal\n");

    expect(
      fileExistsForGap(root, "Workshop/1: General Information/doc.pdf")
    ).toBe(true);
    expect(statNonEmptyFile(file)).toBe(true);
  });

  it("buildExistingPathIndex indexes colon/dash variants", () => {
    const root = mkTmp();
    const dir = path.join(root, "Workshop", "2- Brakes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "page.pdf"), "x");

    const index = buildExistingPathIndex(root);
    expect(index.has("Workshop/2- Brakes/page.pdf")).toBe(true);
    expect(index.has("Workshop/2: Brakes/page.pdf")).toBe(true);
  });

  it("resolveExistingSubdir prefers richer PDF tree", () => {
    const parent = mkTmp();
    const thin = path.join(parent, "1- Engine");
    const rich = path.join(parent, "1: Engine");
    fs.mkdirSync(thin, { recursive: true });
    fs.mkdirSync(rich, { recursive: true });
    fs.writeFileSync(path.join(thin, "a.pdf"), "x");
    fs.writeFileSync(path.join(rich, "a.pdf"), "x");
    fs.writeFileSync(path.join(rich, "b.pdf"), "x");

    const resolved = resolveExistingSubdir(parent, "1: Engine");
    expect(resolved).toBe(rich);
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  isPidAlive,
  isStale,
  releaseLock,
} from "../scripts/bulk-lock";

describe("bulk-lock", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tmpRoots.length = 0;
  });

  function lockDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-bulk-lock-"));
    tmpRoots.push(root);
    return path.join(root, "bulk-download.lock");
  }

  it("acquire and release", () => {
    const dir = lockDir();
    expect(acquireLock(process.pid, dir)).toEqual({ ok: true });
    expect(isStale(dir)).toBe(false);
    releaseLock(String(process.pid), dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("second acquire fails while held", () => {
    const dir = lockDir();
    const holder = String(process.pid);
    expect(acquireLock(holder, dir)).toEqual({ ok: true });
    expect(acquireLock("999999998", dir)).toEqual({
      ok: false,
      holderPid: holder,
    });
    releaseLock(holder, dir);
  });

  it("release ignores wrong holder pid", () => {
    const dir = lockDir();
    acquireLock(111, dir);
    releaseLock("222", dir);
    expect(fs.existsSync(dir)).toBe(true);
    releaseLock("111", dir);
  });

  it("stale lock clears when pid is dead", () => {
    const dir = lockDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pid"), "999999999\n");
    expect(isPidAlive(999999999)).toBe(false);
    expect(isStale(dir)).toBe(true);
    expect(acquireLock(process.pid, dir)).toEqual({ ok: true });
    releaseLock(String(process.pid), dir);
  });
});

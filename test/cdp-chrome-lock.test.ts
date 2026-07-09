import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquire,
  isLocked,
  lockInfo,
  release,
  removeStaleLockIfNeeded,
} from "../scripts/cdp-chrome-lock";

describe("cdp-chrome-lock", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tmpRoots.length = 0;
  });

  function lockDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ford-cdp-lock-"));
    tmpRoots.push(root);
    return path.join(root, "cdp-chrome.lock");
  }

  it("acquire and release by holder", () => {
    const dir = lockDir();
    expect(acquire("connector-test", 0, dir)).toBe(true);
    expect(isLocked(dir)).toBe(true);
    expect(lockInfo(dir)).toEqual({
      holder: "connector-test",
      pid: String(process.pid),
    });
    release("other-holder", dir);
    expect(isLocked(dir)).toBe(true);
    release("connector-test", dir);
    expect(isLocked(dir)).toBe(false);
  });

  it("holder mismatch on release is no-op (lock stays held)", () => {
    const dir = lockDir();
    expect(acquire("connector-a", 0, dir)).toBe(true);
    release("connector-b", dir);
    expect(isLocked(dir)).toBe(true);
    release("connector-a", dir);
    expect(isLocked(dir)).toBe(false);
  });

  it("CDP_LOCK_WAIT_MS path: acquire succeeds after prior holder releases", () => {
    const dir = lockDir();
    expect(acquire("connector-bulk", 0, dir)).toBe(true);
    expect(acquire("capture-params", 0, dir)).toBe(false);
    release("connector-bulk", dir);
    expect(acquire("capture-params", 0, dir)).toBe(true);
    release("capture-params", dir);
  });

  it("removeStaleLockIfNeeded clears dead pid", () => {
    const dir = lockDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "holder"), "dead-job\n");
    fs.writeFileSync(path.join(dir, "pid"), "999999999\n");
    expect(removeStaleLockIfNeeded(dir)).toBe(true);
    expect(isLocked(dir)).toBe(false);
  });
});

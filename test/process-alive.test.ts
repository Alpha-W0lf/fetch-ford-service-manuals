import { describe, expect, it } from "vitest";
import { isProcessAlive } from "../lib/process-alive.js";

describe("process-alive", () => {
  it("returns true for current process pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for invalid or dead pid", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(999_999_999)).toBe(false);
  });
});

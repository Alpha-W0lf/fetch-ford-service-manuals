import { describe, expect, it } from "vitest";
import {
  lockWaitLabel,
  shouldDeferOnLockAcquireFailure,
  shouldDeferOnLockTimeoutError,
} from "../lib/cdp-capture-defer.js";

describe("cdp-capture-defer (CDP_LOCK_YIELD_MS vs CDP_LOCK_WAIT_MS)", () => {
  it("first pass: acquire failure defers when deferOnLockBusy", () => {
    expect(shouldDeferOnLockAcquireFailure(true, false)).toBe(true);
    expect(shouldDeferOnLockAcquireFailure(true, true)).toBe(false);
  });

  it("retry pass: acquire failure does not defer", () => {
    expect(shouldDeferOnLockAcquireFailure(false, false)).toBe(false);
  });

  it("timeout error defers only on first pass", () => {
    const msg = "Timed out waiting for CDP Chrome lock (120000ms)";
    expect(shouldDeferOnLockTimeoutError(true, msg)).toBe(true);
    expect(shouldDeferOnLockTimeoutError(false, msg)).toBe(false);
  });

  it("lockWaitLabel documents yield vs wait env semantics", () => {
    expect(lockWaitLabel(true, 120000)).toContain("CDP_LOCK_YIELD_MS");
    expect(lockWaitLabel(false, 600000)).toContain("CDP_LOCK_WAIT_MS");
  });
});

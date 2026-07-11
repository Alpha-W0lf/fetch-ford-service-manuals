import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVehicleCooldownStore } from "../lib/vehicle-cooldown.js";

describe("vehicle-cooldown", () => {
  const files: string[] = [];
  let now = 1_000_000_000_000;

  afterEach(() => {
    for (const file of files) {
      fs.rmSync(file, { force: true });
      const tmpDir = path.dirname(file);
      if (tmpDir.includes("ford-cooldown-")) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
    files.length = 0;
    vi.restoreAllMocks();
  });

  function mkStore(opts: Record<string, unknown> = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ford-cooldown-"));
    const file = path.join(dir, "vehicle-cooldown.json");
    files.push(file);
    return createVehicleCooldownStore(file, {
      fastFailSec: 60,
      fastFailCount: 3,
      cooldownSec: 900,
      nowMs: () => now,
      ...opts,
    });
  }

  it("increments on fast auth incomplete and excludes at threshold", () => {
    const store = mkStore();
    for (let i = 0; i < 2; i++) {
      const r = store.recordOutcome("v1", {
        runtimeSec: 30,
        authClass: "auth",
        finalStatus: "incomplete",
      });
      expect(r.counted).toBe(true);
      expect(r.excluded).toBe(false);
    }
    const third = store.recordOutcome("v1", {
      runtimeSec: 45,
      authClass: "auth",
      finalStatus: "incomplete",
    });
    expect(third.excluded).toBe(true);
    expect(store.isExcluded("v1")).toBe(true);
    expect(store.getExcludedIds()).toEqual(["v1"]);
  });

  it("does not count slow non-auth or non-incomplete outcomes", () => {
    const store = mkStore();
    expect(
      store.recordOutcome("v1", {
        runtimeSec: 120,
        authClass: "auth",
        finalStatus: "incomplete",
      }).counted
    ).toBe(false);
    expect(
      store.recordOutcome("v1", {
        runtimeSec: 10,
        authClass: null,
        finalStatus: "incomplete",
      }).counted
    ).toBe(false);
    expect(
      store.recordOutcome("v1", {
        runtimeSec: 10,
        authClass: "auth",
        finalStatus: "failed",
      }).counted
    ).toBe(false);
  });

  it("authBudgetStop bypasses fast-fail runtime threshold", () => {
    const store = mkStore({ fastFailCount: 1 });
    const r = store.recordOutcome("v1", {
      runtimeSec: 600,
      authClass: "auth",
      finalStatus: "incomplete",
      authBudgetStop: true,
    });
    expect(r.counted).toBe(true);
    expect(r.excluded).toBe(true);
  });

  it("pruneExpired clears past exclusions", () => {
    const store = mkStore({ fastFailCount: 1, cooldownSec: 10 });
    store.recordOutcome("v1", {
      runtimeSec: 5,
      authClass: "subscription-expired",
      finalStatus: "incomplete",
    });
    expect(store.isExcluded("v1")).toBe(true);
    now += 11_000;
    store.pruneExpired();
    expect(store.isExcluded("v1")).toBe(false);
  });

  it("clearAuthCooldowns resets all vehicles", () => {
    const store = mkStore({ fastFailCount: 1 });
    store.recordOutcome("v1", {
      runtimeSec: 5,
      authClass: "auth",
      finalStatus: "incomplete",
    });
    store.clearAuthCooldowns();
    expect(store.getExcludedIds()).toEqual([]);
    expect(store._getState().vehicles).toEqual({});
  });

  it("recovers from corrupt state file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ford-cooldown-"));
    const file = path.join(dir, "vehicle-cooldown.json");
    files.push(file);
    fs.writeFileSync(file, "{not json");
    const store = createVehicleCooldownStore(file);
    const r = store.recordOutcome("v1", {
      runtimeSec: 5,
      authClass: "auth",
      finalStatus: "incomplete",
    });
    expect(r.counted).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });
});

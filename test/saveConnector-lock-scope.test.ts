import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");

describe("saveConnector lock scope contract", () => {
  it("saveConnector.ts uses withCdpChromeLock per connector", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/wiring/saveConnector.ts"),
      "utf8"
    );
    expect(src).toContain("withCdpChromeLock");
    expect(src).toMatch(/for\s*\(\s*const connector of connectors\)/);
  });

  it("index.ts does not acquire cdp-chrome lock", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
    expect(src).not.toContain("cdp-chrome-lock");
    expect(src).not.toContain("withCdpChromeLock");
  });
});

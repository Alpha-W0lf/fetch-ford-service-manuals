import { describe, expect, it } from "vitest";
import {
  isChromeErrorTab,
  isConnectorCaptureTab,
  isConnectorJobActive,
  isDisposableTab,
  isSafePruneDuringConnectorJob,
  shouldSkipDisposableTabClose,
} from "../lib/cdp-tab-hygiene.js";

describe("cdp-tab-hygiene", () => {
  const faceUrl =
    "https://www.fordtechservice.dealerconnection.com/wiring/face?cell=1";

  it("identifies connector capture tabs", () => {
    expect(isConnectorCaptureTab(faceUrl)).toBe(true);
    expect(isConnectorCaptureTab("about:blank")).toBe(false);
  });

  it("isConnectorJobActive matches connector- holders only", () => {
    expect(isConnectorJobActive({ holder: "connector-12345" })).toBe(true);
    expect(isConnectorJobActive({ holder: "capture-params" })).toBe(false);
    expect(isConnectorJobActive(null)).toBe(false);
  });

  it("isSafePruneDuringConnectorJob never prunes /wiring/face", () => {
    expect(isSafePruneDuringConnectorJob(faceUrl)).toBe(false);
    expect(isSafePruneDuringConnectorJob("about:blank")).toBe(true);
    expect(isSafePruneDuringConnectorJob("chrome-error://dead/")).toBe(true);
  });

  it("isDisposableTab includes blank, errors, and connector URLs", () => {
    expect(isDisposableTab("about:blank")).toBe(true);
    expect(isDisposableTab("chrome-error://x")).toBe(true);
    expect(isDisposableTab(faceUrl)).toBe(true);
    expect(isDisposableTab("https://pts.example.com/home")).toBe(false);
  });

  it("shouldSkipDisposableTabClose preserves kept connector tabs", () => {
    expect(shouldSkipDisposableTabClose(faceUrl, true)).toBe(true);
    expect(shouldSkipDisposableTabClose(faceUrl, false)).toBe(true);
    expect(shouldSkipDisposableTabClose("about:blank", false)).toBe(false);
    expect(
      shouldSkipDisposableTabClose("chrome-error://x", false)
    ).toBe(false);
  });

  it("chrome error connector tab may be closed when not kept", () => {
    const errFace = "chrome-error://chromewebdata/";
    expect(isChromeErrorTab(errFace)).toBe(true);
    expect(shouldSkipDisposableTabClose(errFace, false)).toBe(false);
  });
});

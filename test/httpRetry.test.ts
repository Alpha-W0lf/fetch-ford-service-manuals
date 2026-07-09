import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import {
  computeRetryDelayMs,
  isRetryableHttpError,
  isRetryableNetworkMessage,
} from "../src/httpRetry";

describe("httpRetry", () => {
  it("isRetryableNetworkMessage matches transient codes", () => {
    expect(isRetryableNetworkMessage("read ECONNRESET")).toBe(true);
    expect(isRetryableNetworkMessage("subscription expired")).toBe(false);
  });

  it("isRetryableHttpError retries network errors without response", () => {
    const err = new AxiosError("network");
    expect(isRetryableHttpError(err)).toBe(true);
  });

  it("isRetryableHttpError retries 503", () => {
    const err = new AxiosError("service unavailable", undefined, undefined, undefined, {
      status: 503,
      statusText: "Service Unavailable",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    });
    expect(isRetryableHttpError(err)).toBe(true);
  });

  it("isRetryableHttpError does not retry 403", () => {
    const err = new AxiosError("forbidden", undefined, undefined, undefined, {
      status: 403,
      statusText: "Forbidden",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    });
    expect(isRetryableHttpError(err)).toBe(false);
  });

  it("computeRetryDelayMs stays within cap", () => {
    for (let i = 0; i < 20; i++) {
      const delay = computeRetryDelayMs(10);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(30000);
    }
  });
});

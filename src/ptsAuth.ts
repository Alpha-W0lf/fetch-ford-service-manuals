import { Page } from "playwright";
import { isRetryableNetworkMessage, withTransientRetry } from "./httpRetry";

/** PTS portal rejected the session (stale cookies, logout, or expired subscription). */
export class PtsAuthError extends Error {
  readonly reason: string;

  constructor(message: string, reason = "auth") {
    super(message);
    this.name = "PtsAuthError";
    this.reason = reason;
  }
}

const PTS_AUTH_URL_PATTERN =
  /subscriptionExpired|signin|login|oauth|account\.microsoft/i;

export function isPtsAuthFailureUrl(url: string): boolean {
  return PTS_AUTH_URL_PATTERN.test(url);
}

export function ptsAuthReasonFromUrl(url: string): string {
  if (/subscriptionExpired/i.test(url)) return "subscription-expired";
  if (/signin|login|oauth/i.test(url)) return "auth";
  return "auth";
}

export function gapReasonFromPtsError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/subscriptionExpired|subscription.expired/i.test(msg)) {
    return "subscription-expired";
  }
  if (/ERR_TOO_MANY_REDIRECTS|ERR_HTTP2_PROTOCOL/i.test(msg)) {
    return "auth";
  }
  if (/PTS redirect|PTS auth failure|PTS session warmup failed|Failed to log in/i.test(msg)) {
    return "auth";
  }
  if (/timeout/i.test(msg)) return "timeout";
  if (isRetryableNetworkMessage(msg)) return "network";
  if (/403|access denied/i.test(msg)) return "auth";
  if (/browser has been closed/i.test(msg)) return "browser-closed";
  return "error";
}

export const CONNECTOR_GOTO_TIMEOUT_MS = 45_000;
export const CONNECTOR_SELECTOR_TIMEOUT_MS = 60_000;
export const CONNECTOR_MAX_CONSECUTIVE_AUTH_FAILURES = 3;

async function waitForConnectorTable(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
  } catch {
    // dynamic pages may never reach networkidle
  }
  await page.waitForSelector("table.pintable", {
    timeout: CONNECTOR_SELECTOR_TIMEOUT_MS,
  });
}

/** Establish PTS portal session before wiring/face navigation. */
export async function warmupPtsSession(page: Page): Promise<void> {
  await page.goto("https://www.fordtechservice.dealerconnection.com", {
    waitUntil: "domcontentloaded",
    timeout: CONNECTOR_GOTO_TIMEOUT_MS,
  });
  const url = page.url();
  if (isPtsAuthFailureUrl(url)) {
    throw new PtsAuthError(
      `PTS session warmup failed — auth redirect: ${url}`,
      ptsAuthReasonFromUrl(url)
    );
  }
}

/**
 * Navigate to a connector face page and confirm the pin table rendered.
 * Throws PtsAuthError when PTS redirects to login/subscription pages.
 */
export async function loadConnectorFacePage(
  page: Page,
  url: string,
  options: { warmup?: boolean } = {}
): Promise<void> {
  const notAuthError = (error: unknown) =>
    !(error instanceof PtsAuthError);

  if (options.warmup) {
    await withTransientRetry(() => warmupPtsSession(page), {
      label: "PTS session warmup",
      shouldRetry: notAuthError,
    });
  }

  await withTransientRetry(
    () =>
      page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: CONNECTOR_GOTO_TIMEOUT_MS,
      }),
    { label: `connector goto ${url}`, shouldRetry: notAuthError }
  );

  const currentUrl = page.url();
  if (isPtsAuthFailureUrl(currentUrl)) {
    throw new PtsAuthError(
      `PTS auth redirect: ${currentUrl}`,
      ptsAuthReasonFromUrl(currentUrl)
    );
  }

  try {
    await waitForConnectorTable(page);
  } catch (e) {
    const title = await page.title().catch(() => "");
    const snippet = await page
      .evaluate(() => document.body?.innerText?.slice(0, 200) || "")
      .catch(() => "");
    throw new PtsAuthError(
      `Connector table not found (url: ${currentUrl}, title: ${title}, snippet: ${snippet.slice(0, 120)}): ${
        e instanceof Error ? e.message : String(e)
      }`,
      isPtsAuthFailureUrl(currentUrl) ? ptsAuthReasonFromUrl(currentUrl) : "missing-table"
    );
  }
}

/** Quick probe that connector face pages are reachable with current cookies. */
export async function probeConnectorAccess(
  page: Page,
  faceUrl: string
): Promise<void> {
  await warmupPtsSession(page);

  await page.goto(faceUrl, {
    waitUntil: "domcontentloaded",
    timeout: CONNECTOR_GOTO_TIMEOUT_MS,
  });
  const url = page.url();
  if (isPtsAuthFailureUrl(url)) {
    throw new PtsAuthError(
      `Connector probe failed — PTS auth redirect: ${url}`,
      ptsAuthReasonFromUrl(url)
    );
  }
  try {
    await waitForConnectorTable(page);
  } catch (e) {
    const title = await page.title().catch(() => "");
    throw new PtsAuthError(
      `Connector probe failed — no pintable (url: ${url}, title: ${title}): ${
        e instanceof Error ? e.message : String(e)
      }`,
      "missing-table"
    );
  }
}

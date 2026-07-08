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

const PTS_HOME_URL = "https://www.fordtechservice.dealerconnection.com/";
const MOTORCRAFT_SUBS_URL = "https://www.motorcraftservice.com/MySubscriptions";

/**
 * PTS often redirects to subscriptionExpired when the browser session is stale —
 * not when the Motorcraft subscription actually ended. Try navigation recovery
 * before treating auth as hard-failed.
 */
export async function recoverPtsPageSession(page: Page): Promise<boolean> {
  if (!isPtsAuthFailureUrl(page.url())) return true;

  const before = page.url();
  console.error(`[pts] Recovering stale PTS session (was: ${before})...`);

  const tryGoto = async (url: string) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2000);
  };

  await tryGoto(PTS_HOME_URL);
  if (!isPtsAuthFailureUrl(page.url())) {
    console.error(`[pts] Recovered via PTS home → ${page.url()}`);
    return true;
  }

  await tryGoto(`${PTS_HOME_URL}Home/VehicleMenu`);
  if (!isPtsAuthFailureUrl(page.url())) {
    console.error(`[pts] Recovered via VehicleMenu → ${page.url()}`);
    return true;
  }

  await tryGoto(MOTORCRAFT_SUBS_URL);
  const ptsLink = page
    .locator('a[href*="dealerconnection"], a[href*="fordtechservice"]')
    .first();
  if ((await ptsLink.count()) > 0) {
    await ptsLink.click({ timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    if (!isPtsAuthFailureUrl(page.url())) {
      console.error(`[pts] Recovered via Motorcraft subscriptions → ${page.url()}`);
      return true;
    }
  }

  console.error(`[pts] Recovery failed — still at: ${page.url()}`);
  return false;
}

export async function ensurePtsSessionHealthy(page: Page): Promise<void> {
  if (!isPtsAuthFailureUrl(page.url())) return;
  const ok = await recoverPtsPageSession(page);
  if (!ok) {
    throw new PtsAuthError(
      `PTS session unhealthy (${page.url()}). In Chrome: My Subscriptions → open PTS, or ./scripts/launch-pts-chrome.sh`,
      ptsAuthReasonFromUrl(page.url())
    );
  }
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

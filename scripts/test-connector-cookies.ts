/**
 * Verify PTS portal cookies can load connector face pages.
 * Prefers CDP (live PTS Chrome) when available — matches production connector capture.
 * Exit 0 = OK, 2 = auth/connector failure, 1 = unexpected error.
 *
 * Usage: npx ts-node scripts/test-connector-cookies.ts
 */
import { readFileSync } from "fs";
import transformCookieString from "../src/transformCookieString";
import { chromium } from "playwright";
import { USER_AGENT, SEC_CH_UA } from "../src/constants";
import { probeConnectorAccess } from "../src/ptsAuth";
import { getConnectorProbeUrl } from "../src/connectorProbeUrl";
import { createConnectorPage, pruneOrphanCdpTabs } from "../src/cdpConnectorPage";

const probeUrl = getConnectorProbeUrl(process.cwd());

async function createHeadlessFallback() {
  const raw = readFileSync("templates/cookieString.txt", "utf8").trim();
  const { transformedCookies } = transformCookieString(raw);
  const browser = await chromium.launch({
    headless: process.env.HEADLESS_BROWSER !== "false",
    args: ["--disable-web-security"],
  });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: {
      "sec-ch-ua": SEC_CH_UA,
      "accept-language": "en-us,en;q=0.9",
    },
  });
  await context.route(
    (url) => url.protocol !== "file:",
    async (route) => {
      const headers = await route.request().allHeaders();
      headers["sec-ch-ua"] = SEC_CH_UA;
      await route.continue({ headers });
    }
  );
  await context.addCookies(transformedCookies);
  return { browser, context };
}

(async () => {
  console.log(`Probe URL: ${probeUrl}`);

  let headlessBrowser: Awaited<ReturnType<typeof createHeadlessFallback>> | null =
    null;
  let handle: Awaited<ReturnType<typeof createConnectorPage>> | null = null;

  try {
    headlessBrowser = await createHeadlessFallback();
    handle = await createConnectorPage(headlessBrowser.context);
    await probeConnectorAccess(handle.page, probeUrl);
    console.log(
      `Connector access: OK (${handle.usesCdp ? "CDP / live PTS Chrome" : "headless cookies"})`
    );
    await handle.close();
    await headlessBrowser.browser.close();
    await pruneOrphanCdpTabs();
    process.exit(0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Connector access: FAILED — ${msg}`);
    console.error(
      "Ensure PTS Chrome is open on :9222, logged in at fordtechservice.dealerconnection.com"
    );
    if (handle) await handle.close().catch(() => undefined);
    if (headlessBrowser) await headlessBrowser.browser.close().catch(() => undefined);
    await pruneOrphanCdpTabs().catch(() => undefined);
    process.exit(2);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

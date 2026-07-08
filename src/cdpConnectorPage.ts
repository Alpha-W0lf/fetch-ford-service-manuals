import { chromium, Browser, BrowserContext, Page } from "playwright";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cdpLock = require("../scripts/cdp-chrome-lock") as {
  acquire: (holder: string, maxWaitMs?: number) => boolean;
  release: (holder?: string) => void;
};

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const CDP_LOCK_WAIT_MS = parseInt(process.env.CDP_LOCK_WAIT_MS || "600000", 10);
const CDP_BACKGROUND_TAB = process.env.CDP_BACKGROUND_TAB !== "0";

const CONNECTOR_TAB_URL_RE = /\/wiring\/face\b/i;

function isConnectorCaptureTab(url: string): boolean {
  return CONNECTOR_TAB_URL_RE.test(url);
}

function isDisposableTab(url: string): boolean {
  return url === "about:blank" || isConnectorCaptureTab(url);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open a new tab in live PTS Chrome without stealing macOS focus.
 * Uses CDP Target.createTarget({ background: true }) when enabled.
 */
async function createCdpPage(browser: Browser): Promise<Page> {
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("No CDP browser context");
  }

  if (!CDP_BACKGROUND_TAB) {
    return context.newPage();
  }

  const existing = new Set(context.pages());
  const cdp = await browser.newBrowserCDPSession();
  try {
    await cdp.send("Target.createTarget", {
      url: "about:blank",
      background: true,
    });
  } finally {
    await cdp.detach().catch(() => undefined);
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const page = context.pages().find((p) => !existing.has(p));
    if (page) {
      return page;
    }
    await sleep(100);
  }

  console.warn(
    "Background CDP tab did not attach — falling back to foreground newPage()"
  );
  return context.newPage();
}

export interface ConnectorPageHandle {
  page: Page;
  /** Close the connector page; disconnect CDP if used. */
  close: () => Promise<void>;
  /** True when using live PTS Chrome (preferred for connector auth). */
  usesCdp: boolean;
}

/**
 * Prefer a new page in the logged-in PTS Chrome (CDP) for connector face navigation.
 * Exported cookies often fail in headless Chromium (redirect loops); CDP reuses the live session.
 */
export async function createConnectorPage(
  fallbackContext: BrowserContext
): Promise<ConnectorPageHandle> {
  let cdpBrowser: Browser | null = null;
  const lockHolder = `connector-${process.pid}`;
  let lockHeld = false;
  try {
    if (
      !cdpLock.acquire(lockHolder, CDP_LOCK_WAIT_MS)
    ) {
      throw new Error(
        `Timed out waiting for PTS Chrome CDP lock (${CDP_LOCK_WAIT_MS}ms)`
      );
    }
    lockHeld = true;
    cdpBrowser = await chromium.connectOverCDP(CDP_URL);
    const contexts = cdpBrowser.contexts();
    if (contexts.length > 0) {
      const page = await createCdpPage(cdpBrowser);
      console.log(
        CDP_BACKGROUND_TAB
          ? "Using PTS Chrome (CDP, background tab) for connector capture"
          : "Using PTS Chrome (CDP) for connector capture"
      );
      return {
        page,
        usesCdp: true,
        close: async () => {
          try {
            await page.close().catch(() => undefined);
            await cdpBrowser?.close().catch(() => undefined);
          } finally {
            if (lockHeld) {
              cdpLock.release(lockHolder);
              lockHeld = false;
            }
          }
        },
      };
    }
    await cdpBrowser.close().catch(() => undefined);
    if (lockHeld) {
      cdpLock.release(lockHolder);
      lockHeld = false;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (lockHeld) {
      cdpLock.release(lockHolder);
      lockHeld = false;
    }
    console.warn(
      `CDP connector page unavailable (${msg}) — falling back to headless context`
    );
    if (cdpBrowser) {
      await cdpBrowser.close().catch(() => undefined);
    }
  }

  const page = await fallbackContext.newPage();
  return {
    page,
    usesCdp: false,
    close: async () => {
      await page.close().catch(() => undefined);
    },
  };
}

export interface PruneCdpTabsOptions {
  /** Keep at most this many connector (/wiring/face) tabs (default: PARALLEL env or 2). */
  maxConnectorTabs?: number;
}

/**
 * Close orphan connector-capture tabs in live PTS Chrome.
 * Keeps up to maxConnectorTabs wiring/face pages (active parallel workers) and always
 * removes about:blank tabs. Safe to call after each vehicle job completes.
 */
export async function pruneOrphanCdpTabs(
  options: PruneCdpTabsOptions = {}
): Promise<{ closed: number; remainingConnectorTabs: number }> {
  const maxConnectorTabs =
    options.maxConnectorTabs ??
    (parseInt(process.env.PARALLEL || "2", 10) || 2);

  let cdpBrowser: Browser | null = null;
  try {
    cdpBrowser = await chromium.connectOverCDP(CDP_URL);
    const contexts = cdpBrowser.contexts();
    if (contexts.length === 0) {
      return { closed: 0, remainingConnectorTabs: 0 };
    }

    const pages = contexts[0].pages();
    const connectorTabs = pages.filter((p) => isConnectorCaptureTab(p.url()));
    const disposable = pages.filter((p) => isDisposableTab(p.url()));

    let closed = 0;
    const connectorOverflow = connectorTabs.length - maxConnectorTabs;
    if (connectorOverflow > 0) {
      for (const page of connectorTabs.slice(0, connectorOverflow)) {
        await page.close().catch(() => undefined);
        closed += 1;
      }
    }

    const keptConnector = new Set(
      connectorTabs.slice(Math.max(0, connectorTabs.length - maxConnectorTabs))
    );
    for (const page of disposable) {
      if (keptConnector.has(page)) continue;
      if (isConnectorCaptureTab(page.url())) continue;
      await page.close().catch(() => undefined);
      closed += 1;
    }

    const remaining = contexts[0]
      .pages()
      .filter((p) => isConnectorCaptureTab(p.url())).length;
    if (closed > 0) {
      console.log(
        `Pruned ${closed} orphan CDP tab(s); ${remaining} connector tab(s) remain (max ${maxConnectorTabs})`
      );
    }
    return { closed, remainingConnectorTabs: remaining };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`CDP tab prune skipped (${msg})`);
    return { closed: 0, remainingConnectorTabs: 0 };
  } finally {
    await cdpBrowser?.close().catch(() => undefined);
  }
}

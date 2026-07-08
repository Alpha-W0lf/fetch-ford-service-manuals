import { Page } from "playwright";

const SET_CONTENT_OPTS = {
  waitUntil: "domcontentloaded" as const,
  timeout: 30_000,
};

const RETRY_SET_CONTENT_OPTS = {
  waitUntil: "domcontentloaded" as const,
  timeout: 45_000,
};

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "TimeoutError" || /timeout/i.test(error.message);
  }
  return /timeout/i.test(String(error));
}

/** Inject HTML and wait for DOM; retry once after 2s on timeout. */
export async function setContentWithRetry(
  page: Page,
  html: string
): Promise<void> {
  try {
    await page.setContent(html, SET_CONTENT_OPTS);
  } catch (error) {
    if (!isTimeoutError(error)) {
      throw error;
    }
    await page.waitForTimeout(2000);
    await page.setContent(html, RETRY_SET_CONTENT_OPTS);
  }
}

export async function renderWorkshopPageToPdf(
  page: Page,
  html: string,
  pdfPath: string
): Promise<void> {
  await setContentWithRetry(page, html);
  await page.evaluate(
    'document.querySelectorAll("body > div > table > tbody > tr > td:nth-child(2)").forEach(e => e.remove())'
  );
  await page.pdf({ path: pdfPath });
}

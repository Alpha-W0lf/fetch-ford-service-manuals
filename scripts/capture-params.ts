#!/usr/bin/env ts-node
/**
 * Capture params.json for queued vehicles via PTS navigation + network intercept.
 *
 * Preferred: attach to your logged-in Chrome (CDP mode)
 *   ./scripts/launch-pts-chrome.sh
 *   yarn capture-params --tier 1 --limit 5
 *   yarn capture-params --all
 *
 * Fallback (unreliable — PTS iframe often empty without live Chrome session):
 *   yarn capture-params --no-cdp --limit 5
 *
 * Coordination: acquires logs/cdp-chrome.lock while running in CDP mode so bulk
 * connector jobs wait instead of closing the browser. Prefer:
 *   ./scripts/run-capture-params.sh
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";

const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cdpLock = require("./cdp-chrome-lock") as {
  acquire: (holder: string, maxWaitMs?: number) => boolean;
  release: (holder?: string) => void;
};
import { chromium, Page, Frame, Request, Browser, BrowserContext } from "playwright";
import qs from "qs";
import transformCookieString from "../src/transformCookieString";
import { USER_AGENT, SEC_CH_UA } from "../src/constants";
import { ensurePtsSessionHealthy, recoverPtsPageSession } from "../src/ptsAuth";

const ROOT = join(__dirname, "..");
const QUEUE_PATH = join(ROOT, "templates/vehicles.json");
const PATCH_QUEUE = join(ROOT, "scripts/patch-queue.js");

async function patchVehicleStatus(vehicleId: string, status: string): Promise<void> {
  await execFileAsync("node", [PATCH_QUEUE, vehicleId, status]);
}
const COOKIE_PATH = join(ROOT, "templates/cookieString.txt");
const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const PTS_HOME = "https://www.fordtechservice.dealerconnection.com/";
const VEHICLE_MENU = "https://www.fordtechservice.dealerconnection.com/Home/VehicleMenu";

const CAPTURE_DELAY_SEC = parseInt(process.env.CAPTURE_DELAY_SEC || "4", 10);
const CAPTURE_PAUSE_EVERY = parseInt(process.env.CAPTURE_PAUSE_EVERY || "25", 10);
const CAPTURE_PAUSE_SEC = parseInt(process.env.CAPTURE_PAUSE_SEC || "60", 10);
const CAPTURE_MAX_CONSECUTIVE_FAILS = parseInt(process.env.CAPTURE_MAX_CONSECUTIVE_FAILS || "5", 10);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type VidContext = Page | Frame;

interface VehicleEntry {
  id: string;
  label: string;
  ptsModel: string;
  modelYear: number;
  tier?: number;
  paramsFile: string;
  status: string;
}

interface Queue {
  vehicles: VehicleEntry[];
}

const WORKSHOP_KEYS = [
  "vehicleId",
  "modelYear",
  "channel",
  "book",
  "bookTitle",
  "WiringBookCode",
  "WiringBookTitle",
  "booktype",
  "country",
  "language",
  "contentmarket",
  "contentlanguage",
  "languageOdysseyCode",
  "searchNumber",
  "Vid",
  "byvin",
  "marketGroup",
  "category",
  "CategoryDescription",
] as const;

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 10;
  let tier: number | undefined;
  let useCdp = process.env.USE_CDP !== "false";
  let all = false;
  let includeLegacy = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[i + 1], 10);
    if (args[i] === "--tier" && args[i + 1]) tier = parseInt(args[i + 1], 10);
    if (args[i] === "--no-cdp") useCdp = false;
    if (args[i] === "--cdp") useCdp = true;
    if (args[i] === "--all") all = true;
    if (args[i] === "--include-legacy") includeLegacy = true;
  }
  if (all) limit = 9999;
  return { limit, tier, useCdp, includeLegacy };
}

function modelMatchers(ptsModel: string): string[] {
  const m = ptsModel.trim();
  if (m === "F-650" || m === "F-750") return ["F-650/750", m];
  if (m === "Expedition MAX" || m === "Expedition Max")
    return ["Expedition Max", "Expedition MAX", "Expedition"];
  if (m === "Police Interceptor Utility")
    return ["Police Interceptor Utility", "Explorer"];
  if (m === "Police Interceptor Sedan")
    return ["Police Interceptor Sedan", "Taurus"];
  if (m === "E-Transit")
    return [
      "E-Transit",
      "E Transit",
      "E-Transit Cargo Van",
      "E-Transit Cargo",
      "E-Transit™",
    ];
  return [m];
}

function createCaptureState() {
  const workshop: Record<string, string> = {};
  const wiring: Record<string, string> = {};

  const handler = (request: Request) => {
    const url = request.url();
    if (url.includes("TreeAndCover/workshop") && request.method() === "POST") {
      const u = new URL(url);
      const qBookTitle = u.searchParams.get("bookTitle");
      const qWiringBookTitle = u.searchParams.get("WiringBookTitle");
      if (qBookTitle) workshop.bookTitle = qBookTitle;
      if (qWiringBookTitle) workshop.WiringBookTitle = qWiringBookTitle;

      const body = request.postData();
      if (!body) return;
      const parsed = qs.parse(body) as Record<string, string>;
      for (const k of WORKSHOP_KEYS) {
        if (parsed[k] != null && parsed[k] !== "") workshop[k] = String(parsed[k]);
      }
    }
    if (
      url.includes("fordservicecontent.com") &&
      url.includes("/wiring/TableofContent") &&
      request.method() === "GET"
    ) {
      const u = new URL(url);
      const env = u.searchParams.get("environment");
      const bookType = u.searchParams.get("bookType");
      const languageCode = u.searchParams.get("languageCode");
      if (env) wiring.environment = env;
      if (bookType) wiring.bookType = bookType;
      if (languageCode) wiring.languageCode = languageCode;
    }
    if (url.includes("dealerconnection.com/wiring/TableOfContents") && request.method() === "GET") {
      const u = new URL(url);
      const book = u.searchParams.get("book");
      const booktitle = u.searchParams.get("booktitle");
      if (book && !workshop.WiringBookCode) workshop.WiringBookCode = book;
      if (booktitle && !workshop.WiringBookTitle) workshop.WiringBookTitle = booktitle;
    }
  };

  return {
    workshop,
    wiring,
    handler,
    attach(context: BrowserContext) {
      context.on("request", handler);
    },
    detach(context: BrowserContext) {
      context.off("request", handler);
    },
  };
}

async function applyCookies(context: BrowserContext) {
  const raw = (await readFile(COOKIE_PATH, "utf8")).trim();
  const { transformedCookies } = transformCookieString(raw);
  await context.addCookies(transformedCookies);
}

async function connectBrowser(useCdp: boolean): Promise<{ browser: Browser; closeOnDone: boolean }> {
  if (useCdp) {
    try {
      const browser = await chromium.connectOverCDP(CDP_URL);
      console.log(`Connected to Chrome via CDP (${CDP_URL})`);
      return { browser, closeOnDone: false };
    } catch (err: any) {
      console.warn(`CDP connect failed: ${err?.message || err}`);
      console.warn("Start Chrome with: ./scripts/launch-pts-chrome.sh");
      console.warn("Falling back to headless Playwright + cookies...");
    }
  }

  const browser = await chromium.launch({
    headless: process.env.HEADLESS_BROWSER !== "false",
    args: ["--disable-web-security", "--disable-http2", "--http1.1"],
  });
  return { browser, closeOnDone: true };
}

async function getBrowserContext(browser: Browser, useCdp: boolean): Promise<BrowserContext> {
  if (useCdp && browser.contexts().length > 0) {
    return browser.contexts()[0];
  }

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { "sec-ch-ua": SEC_CH_UA, "accept-language": "en-US,en;q=0.9" },
  });
  await applyCookies(context);
  return context;
}

async function getPtsPage(context: BrowserContext): Promise<Page> {
  for (const page of context.pages()) {
    const url = page.url();
    if (url.includes("fordtechservice.dealerconnection.com") && !url.includes("login.microsoftonline")) {
      await ensurePtsSessionHealthy(page).catch(() => recoverPtsPageSession(page));
      return page;
    }
  }

  const page = await context.newPage();
  await page.goto(PTS_HOME, { waitUntil: "domcontentloaded", timeout: 90000 });
  await ensurePtsSessionHealthy(page);
  return page;
}

async function dismissBlockingModals(page: Page, vid: VidContext) {
  const targets = [
    page.locator(".modal.in:visible button.close"),
    page.locator(".modal.in:visible button:has-text('OK')"),
    page.locator(".modal.in:visible button:has-text('Close')"),
    vid.locator(".modal.in:visible button.close"),
    vid.locator(".modal.in:visible button:has-text('OK')"),
    vid.locator(".modal.in:visible button:has-text('Close')"),
  ];

  for (const loc of targets) {
    if ((await loc.count()) > 0) {
      await loc.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

function logStep(msg: string) {
  console.log(`  [capture] ${msg}`);
}

async function ensurePtsHome(page: Page, force = false) {
  const url = page.url();
  const onHome =
    url.includes("fordtechservice.dealerconnection.com") &&
    !url.includes("VehicleMenu") &&
    !url.includes("login.microsoftonline");
  if (!force && onHome) return;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(PTS_HOME, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(1500);
      await ensurePtsSessionHealthy(page);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      logStep(`PTS home load failed (${attempt}/3), retrying...`);
      await recoverPtsPageSession(page).catch(() => {});
      await page.waitForTimeout(3000);
    }
  }
}

/** Return PTS to Vehicle ID iframe — call after each capture and before retries. */
async function resetPtsSession(page: Page) {
  logStep("Resetting PTS session to home...");
  await ensurePtsHome(page, true);
  await getVidFrame(page, true);
}

async function getVidFrame(page: Page, reload = false): Promise<Frame> {
  const deadline = Date.now() + 90000;
  await ensurePtsHome(page);

  let frame =
    page.frame({ name: "mainTabFrame-VID" }) ??
    page.frames().find((f) => f.url().includes("VehicleMenu"));

  const frameReady = async (f: Frame | undefined) =>
    !!f && (await f.locator("#yearList").count()) > 0;

  if (!(await frameReady(frame)) || reload) {
    logStep(reload ? "Reloading Vehicle ID iframe..." : "Opening Vehicle ID tab...");
    await page
      .locator("a, li, span, div")
      .filter({ hasText: /^Vehicle\s*ID$/i })
      .first()
      .click({ timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(2000);
    frame =
      page.frame({ name: "mainTabFrame-VID" }) ??
      page.frames().find((f) => f.url().includes("VehicleMenu"));
    if (frame && reload) {
      await frame.goto(VEHICLE_MENU, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  }

  while (!(await frameReady(frame))) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for VehicleMenu iframe (#yearList)");
    }
    await page.waitForTimeout(1000);
    frame =
      page.frame({ name: "mainTabFrame-VID" }) ??
      page.frames().find((f) => f.url().includes("VehicleMenu"));
  }

  return frame!;
}

async function clickYearModelTab(vid: VidContext) {
  const yearListVisible = await vid
    .locator("#yearList")
    .first()
    .isVisible()
    .catch(() => false);
  if (yearListVisible) return;

  const tab = vid.locator("#yearmodelselect").first();
  if ((await tab.count()) > 0) {
    await tab.evaluate((el: HTMLElement) => el.click());
    await vid.waitForTimeout(500);
  }
}

async function selectModel(vid: VidContext, ptsModel: string) {
  const tryClick = async (loc: ReturnType<VidContext["locator"]>) => {
    if ((await loc.count()) === 0) return false;
    try {
      await loc.first().click({ timeout: 5000 });
    } catch {
      await loc.first().evaluate((el: HTMLElement) => el.click());
    }
    return true;
  };

  for (const candidate of modelMatchers(ptsModel)) {
    const exact = vid.locator("#modelList a").filter({ hasText: candidate });
    if (await tryClick(exact)) return;
  }

  const partial = vid.locator("#modelList a").filter({ hasText: ptsModel });
  if (await tryClick(partial)) return;

  if (/e[\s-]*transit/i.test(ptsModel)) {
    const eTransit = vid.locator("#modelList a").filter({ hasText: /e[\s-]*transit/i });
    if (await tryClick(eTransit)) return;
  }

  const available = await vid
    .locator("#modelList a")
    .evaluateAll((els) =>
      els.map((el) => (el.textContent || "").trim()).filter(Boolean)
    )
    .catch(() => [] as string[]);
  const hint =
    available.length > 0
      ? ` Available models: ${available.slice(0, 20).join(", ")}${available.length > 20 ? "…" : ""}`
      : "";
  throw new Error(`Model not found in PTS menu: ${ptsModel}.${hint}`);
}

async function waitForVehicleCommitted(page: Page, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await ensurePtsHome(page);
    const text = await page.locator("body").innerText();
    if (!/No Vehicle Selected/i.test(text)) {
      logStep("Vehicle committed to session");
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("Vehicle was not committed (header still shows No Vehicle Selected)");
}

async function submitExampleVin(vid: Frame) {
  const hasFns = await vid.evaluate(() => ({
    getexamplevin: typeof (window as any).getexamplevin === "function",
    onClickSubmit: typeof (window as any).onClickSubmit === "function",
    ROAPI: typeof (window as any).ROAPI === "function",
  }));
  if (!hasFns.getexamplevin || !hasFns.onClickSubmit) {
    throw new Error("PTS vehicle menu functions not available in iframe");
  }

  logStep("Fetching example VIN (getexamplevin)...");
  await vid.evaluate(() => (window as any).getexamplevin());
  await vid.waitForFunction(
    () => {
      const el = document.querySelector("#vin") as HTMLInputElement | null;
      return !!el?.value && el.value.length === 17;
    },
    { timeout: 45000 }
  );

  const vin = await vid.locator("#vin").inputValue();
  logStep(`Example VIN: ${vin}`);

  logStep("Submitting VIN (onClickSubmit + ROAPI)...");
  await vid.evaluate(() => {
    const w = window as any;
    w.$("#registration").val("");
    w.onClickSubmit(true);
    if (typeof w.updateStartingTab === "function") w.updateStartingTab("Vin");
    if (typeof w.ROAPI === "function") w.ROAPI();
  });
}

async function selectYear(vid: VidContext, year: number) {
  await clickYearModelTab(vid);

  const byId = vid.locator(`#year${year}`);
  if ((await byId.count()) > 0) {
    await byId.first().evaluate((el: HTMLElement) => el.click());
    return;
  }

  const yearLink = vid
    .locator("#yearList a")
    .filter({ hasText: new RegExp(`^${year}$`) })
    .first();
  await yearLink.waitFor({ state: "attached", timeout: 15000 });
  try {
    await yearLink.click({ timeout: 5000 });
  } catch {
    // PTS often keeps year links in DOM but hidden until layout settles.
    await yearLink.evaluate((el: HTMLElement) => el.click());
  }
}

async function commitVehicle(page: Page, year: number, ptsModel: string) {
  const vid = await getVidFrame(page, true);
  await dismissBlockingModals(page, vid);
  await clickYearModelTab(vid);

  logStep(`Selecting ${ptsModel} ${year}...`);
  await selectYear(vid, year);

  await vid.locator("#modelList a").first().waitFor({ state: "attached", timeout: 30000 });
  await page.waitForTimeout(500);
  await selectModel(vid, ptsModel);
  await page.waitForTimeout(800);

  await submitExampleVin(vid);
  await page.waitForTimeout(2000);
  await dismissBlockingModals(page, vid);
  await waitForVehicleCommitted(page);
}

async function clickPtsMainTab(page: Page, label: "Workshop" | "Wiring") {
  await dismissBlockingModals(page, page);
  await page.waitForTimeout(500);

  const idCandidates =
    label === "Workshop"
      ? ["mainTabLink-WSM"]
      : ["mainTabLink-WIR", "mainTabLink-EWD", "mainTabLink-WD", "mainTabLink-WRG"];

  for (const id of idCandidates) {
    const byId = page.locator(`#${id}`);
    if ((await byId.count()) > 0) {
      await byId.first().evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(1000);
      return;
    }
  }

  const byLabel = page.getByRole("link", { name: label, exact: true });
  await byLabel.first().waitFor({ state: "attached", timeout: 15000 });
  try {
    await byLabel.first().click({ timeout: 5000, force: true });
  } catch {
    // Tab bar (#mainTabsUl) often intercepts pointer events — JS click is reliable.
    await byLabel.first().evaluate((el: HTMLElement) => el.click());
  }
  await page.waitForTimeout(1000);
}

async function openWorkshopAndWiring(page: Page, capture: ReturnType<typeof createCaptureState>) {
  await ensurePtsHome(page);
  await page.waitForTimeout(1000);
  await dismissBlockingModals(page, page);

  logStep("Opening Workshop tab...");
  await clickPtsMainTab(page, "Workshop");
  await page.waitForTimeout(10000);

  if (!capture.workshop.vehicleId) {
    throw new Error("Workshop tab did not trigger TreeAndCover/workshop request");
  }

  logStep("Opening Wiring tab...");
  await clickPtsMainTab(page, "Wiring");
  await page.waitForTimeout(10000);
}

function isRetryableCaptureError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("mainTabFrame-VID") ||
    msg.includes("TreeAndCover/workshop") ||
    msg.includes("PTS vehicle menu functions not available") ||
    msg.includes("intercepts pointer events") ||
    msg.includes("Workshop tab did not trigger") ||
    msg.includes("Frame was detached") ||
    msg.includes("#modelList a") ||
    msg.includes("PTS session unhealthy") ||
    msg.includes("subscriptionExpired") ||
    msg.includes("VehicleMenu iframe")
  );
}

function buildParams(workshop: Record<string, string>, wiring: Record<string, string>, year: number, ptsModel: string) {
  if (!workshop.vehicleId || !workshop.book) {
    throw new Error(`Missing workshop params for ${year} ${ptsModel}`);
  }
  if (!workshop.bookTitle) {
    workshop.bookTitle = `${year} ${ptsModel}`;
  }
  if (!workshop.WiringBookTitle) {
    workshop.WiringBookTitle = workshop.bookTitle;
  }
  if (!wiring.environment) {
    throw new Error(`Missing wiring params for ${year} ${ptsModel}`);
  }

  return {
    workshop: {
      ...workshop,
      modelYear: workshop.modelYear || String(year),
      byvin: workshop.byvin || "NO",
      country: workshop.country || "USA",
      language: workshop.language || "EN-US",
      contentmarket: workshop.contentmarket || "US",
      contentlanguage: workshop.contentlanguage || "EN",
      languageOdysseyCode: workshop.languageOdysseyCode || "ENUSA",
      searchNumber: workshop.searchNumber || "0",
      Vid: workshop.Vid || "CZF",
      marketGroup: workshop.marketGroup || "NA",
      channel: workshop.channel || "9",
      booktype: workshop.booktype || "ody",
    },
    wiring: {
      environment: wiring.environment,
      bookType: wiring.bookType || "svg",
      languageCode: wiring.languageCode || "ENUSA",
    },
    pre_2003: {
      alphabeticalIndexURL: "https://www.fordservicecontent.com/pubs/content/.....",
    },
  };
}

async function captureParamsOnce(
  page: Page,
  year: number,
  ptsModel: string,
  context: BrowserContext
) {
  const capture = createCaptureState();
  capture.attach(context);

  try {
    await commitVehicle(page, year, ptsModel);
    await openWorkshopAndWiring(page, capture);
    return buildParams(capture.workshop, capture.wiring, year, ptsModel);
  } finally {
    capture.detach(context);
  }
}

async function captureParams(page: Page, year: number, ptsModel: string, context: BrowserContext) {
  try {
    return await captureParamsOnce(page, year, ptsModel, context);
  } catch (err) {
    if (!isRetryableCaptureError(err)) throw err;
    logStep("Retryable error — resetting PTS session and retrying once...");
    await resetPtsSession(page);
    return await captureParamsOnce(page, year, ptsModel, context);
  }
}

async function main() {
  const { limit, tier, useCdp, includeLegacy } = parseArgs();
  if (!useCdp) {
    console.warn(
      "WARN: --no-cdp headless mode often fails PTS Vehicle ID iframe navigation. Use CDP Chrome."
    );
  }

  const queue: Queue = JSON.parse(await readFile(QUEUE_PATH, "utf8"));

  let targets = queue.vehicles.filter((v) => v.status === "needs_params");
  if (tier != null) targets = targets.filter((v) => v.tier === tier);
  targets = targets
    .sort((a, b) => {
      const tierA = a.tier ?? 99;
      const tierB = b.tier ?? 99;
      if (tierA !== tierB) return tierA - tierB;
      // Post-2002 PTS UI first — pre-2003 vehicles need separate validation.
      const modernA = a.modelYear >= 2003 ? 0 : 1;
      const modernB = b.modelYear >= 2003 ? 0 : 1;
      if (modernA !== modernB) return modernA - modernB;
      return a.modelYear - b.modelYear;
    })
    .slice(0, limit);

  if (!includeLegacy) {
    const deferred = targets.filter((v) => v.modelYear < 2003);
    if (deferred.length) {
      console.log(
        `Deferring ${deferred.length} pre-2003 vehicle(s) — use --include-legacy after modern queue is clear`
      );
    }
    targets = targets.filter((v) => v.modelYear >= 2003);
  }

  if (!targets.length) {
    console.log("No vehicles to capture.");
    return;
  }

  console.log(`Capturing params for ${targets.length} vehicle(s)...`);

  const lockHolder = "capture-params";
  const lockWaitMs = parseInt(process.env.CDP_LOCK_WAIT_MS || "600000", 10);
  await runCaptureSession(targets, useCdp, lockHolder, lockWaitMs);
}

async function runCaptureSession(
  targets: VehicleEntry[],
  useCdp: boolean,
  lockHolder: string,
  lockWaitMs: number
) {
  const { browser, closeOnDone } = await connectBrowser(useCdp);
  const context = await getBrowserContext(browser, useCdp && browser.contexts().length > 0);
  const page = await getPtsPage(context);

  if (page.url().includes("login.microsoftonline") || page.url().includes("subscriptionExpired")) {
    throw new Error("PTS is not logged in or subscription expired. Log in via launch-pts-chrome.sh first.");
  }
  if (page.url().includes("signinBackDoor") || page.url().includes("ExternalLogin")) {
    throw new Error(
      "PTS login callback is stuck (ExternalLogin/signinBackDoor). Quit Chrome, run ./scripts/launch-pts-chrome.sh again, and log in fresh."
    );
  }

  let ok = 0;
  let fail = 0;
  let consecutiveFails = 0;

  console.log(
    `Pacing: ${CAPTURE_DELAY_SEC}s between vehicles, pause ${CAPTURE_PAUSE_SEC}s every ${CAPTURE_PAUSE_EVERY}, stop after ${CAPTURE_MAX_CONSECUTIVE_FAILS} consecutive fails`
  );

  for (let i = 0; i < targets.length; i++) {
    const vehicle = targets[i];
    console.log(`\n=== ${vehicle.id} (${vehicle.ptsModel} ${vehicle.modelYear}) ===`);
    let lockHeld = false;
    try {
      if (useCdp) {
        if (!cdpLock.acquire(lockHolder, lockWaitMs)) {
          throw new Error(`Timed out waiting for CDP Chrome lock (${lockWaitMs}ms)`);
        }
        lockHeld = true;
      }
      const params = await captureParams(page, vehicle.modelYear, vehicle.ptsModel, context);
      const outDir = join(ROOT, "vehicles", vehicle.id);
      await mkdir(outDir, { recursive: true });
      const outPath = join(ROOT, vehicle.paramsFile);
      await writeFile(outPath, JSON.stringify(params, null, 2) + "\n");
      await patchVehicleStatus(vehicle.id, "pending");
      ok++;
      consecutiveFails = 0;
      console.log(`OK: ${outPath}`);
      const w = params.workshop as Record<string, string>;
      console.log(`  book=${w.book} vehicleId=${w.vehicleId} env=${params.wiring.environment}`);
    } catch (err: any) {
      fail++;
      consecutiveFails++;
      console.error(`FAIL ${vehicle.id}: ${err.message || err}`);
      if (
        String(err.message || err).includes("PTS session") ||
        String(err.message || err).includes("subscriptionExpired")
      ) {
        logStep("Attempting PTS session recovery before next vehicle...");
        await recoverPtsPageSession(page).catch(() => {});
      }
      if (consecutiveFails >= CAPTURE_MAX_CONSECUTIVE_FAILS) {
        console.error(
          `\nStopping: ${consecutiveFails} consecutive failures. Refresh PTS in Chrome (launch-pts-chrome.sh) and re-run capture.`
        );
        break;
      }
    } finally {
      if (lockHeld) cdpLock.release(lockHolder);
    }

    try {
      await resetPtsSession(page);
    } catch (resetErr: any) {
      console.error(`WARN reset after ${vehicle.id}: ${resetErr.message || resetErr}`);
      consecutiveFails++;
      if (consecutiveFails >= CAPTURE_MAX_CONSECUTIVE_FAILS) {
        console.error(
          `\nStopping: PTS session unhealthy (${resetErr.message || resetErr}). Restart Chrome via launch-pts-chrome.sh and re-run.`
        );
        break;
      }
    }

    if (i < targets.length - 1) {
      if (CAPTURE_PAUSE_EVERY > 0 && (i + 1) % CAPTURE_PAUSE_EVERY === 0) {
        logStep(`Batch pause ${CAPTURE_PAUSE_SEC}s after ${i + 1} vehicles...`);
        await sleep(CAPTURE_PAUSE_SEC * 1000);
      } else if (CAPTURE_DELAY_SEC > 0) {
        await sleep(CAPTURE_DELAY_SEC * 1000);
      }
    }
  }

  if (closeOnDone) {
    await browser.close();
  } else {
    console.log("\nLeaving your Chrome window open (CDP mode).");
  }

  console.log(`\nDone: ${ok} captured, ${fail} failed. Run ./scripts/queue-status.sh to review.`);
  if (ok > 0) {
    console.log("Start downloads: caffeinate -dims PARALLEL=2 ./scripts/bulk-download.sh");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

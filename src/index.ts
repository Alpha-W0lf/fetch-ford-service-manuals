import { writeFile, readFile, mkdir } from "fs/promises";
import { fileExistsNonEmpty } from "./utils";
import fetchTableOfContents, {
  WiringFetchParams,
} from "./wiring/fetchTableOfContents";
import saveEntireWiring from "./wiring/saveEntireWiring";
import transformCookieString from "./transformCookieString";
import { chromium, Page, BrowserContext } from "playwright";
import { join } from "path";
import saveEntireManual, { SaveOptions } from "./workshop/saveEntireManual";
import readConfig, { Config } from "./readConfig";
import processCLIArgs, { CLIArgs } from "./processCLIArgs";
import fetchPre2003AlphabeticalIndex from "./pre-2003/fetchAlphabeticalIndex";
import saveEntirePre2003AlphabeticalIndex from "./pre-2003/saveEntireAlphabeticalIndex";
import client from "./client";
import { logHttpError } from "./logHttpError";
import CaptureGaps from "./captureGaps";
import {
  USER_AGENT,
  SEC_CH_UA,
  ENV_USE_PROXY,
  ENV_HEADLESS_BROWSER,
} from "./constants";
import { probeConnectorAccess, PtsAuthError } from "./ptsAuth";
import { getConnectorProbeUrl } from "./connectorProbeUrl";
import { pruneOrphanCdpTabs } from "./cdpConnectorPage";
import {
  modernWorkshop,
  resolveWiringTableOfContents,
} from "./jobHelpers";

async function run({
  configPath,
  outputPath,
  cookiePath,
  doWorkshopDownload,
  doWiringDownload,
  doParamsValidation,
  doCookieTest,
  connectorsOnly,
  ...restArgs
}: CLIArgs) {
  const config = await readConfig(configPath, doParamsValidation);
  const captureGaps = await CaptureGaps.load(outputPath);
  let runWorkshop = doWorkshopDownload;
  const runWiring = doWiringDownload || connectorsOnly;
  if (connectorsOnly) {
    runWorkshop = false;
  }
  const saveOptions: SaveOptions = {
    saveHTML: restArgs.saveHTML ?? false,
    ignoreSaveErrors: restArgs.ignoreSaveErrors ?? false,
    outputRoot: outputPath,
    captureGaps,
  };

  // create output dir
  try {
    await mkdir(outputPath, { recursive: true });
  } catch (e: any) {
    if (e.code !== "EEXIST") {
      console.error(`Error creating output directory ${outputPath}: ${e}`);
      process.exit(1);
    }
  }

  console.log("Processing cookies...");
  let rawCookieString = (await readFile(cookiePath, { encoding: "utf-8" }))
    .trim()
    .replaceAll("\n", " ");
  let { transformedCookies, processedCookieString } =
    transformCookieString(rawCookieString);

  // Add the cookie string to the Axios client
  // It'll be sent with every request automatically
  client.defaults.headers.Cookie = processedCookieString;

  console.log("Creating a headless chromium instance...");
  const browser = await chromium.launch({
    // fix getting wiring SVGs
    args: ["--disable-web-security"],
    headless: ENV_HEADLESS_BROWSER,
    proxy: ENV_USE_PROXY ? { server: "localhost:8888" } : undefined,
  });

  // getBrowserContext applies modifications required for Headless Chrome to
  // work with PTS. This includes setting the User-Agent and sec-ch-ua headers,
  // and adding the cookies.
  const getBrowserContext = async (): Promise<BrowserContext> => {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      extraHTTPHeaders: {
        // Without this, Playwright will put "HeadlessChrome" in here and PTS will reject the request
        // When headers here conflict with default headers, the ones here take precedence.
        // HOWEVER, these headers are only used for direct requests from `page.goto()`.
        // This means that they are NOT used when the browser is redirected.
        "sec-ch-ua": SEC_CH_UA,
        // TODO: Playwright bug: accept-language header not set in headless mode
        "accept-language": `${config.workshop.contentlanguage.toLowerCase()}-${
          config.workshop.contentmarket
        },${config.workshop.contentlanguage.toLowerCase()};q=0.9`,
      },
    });

    // Mask the sec-ch-ua header on all non-file routes.
    await context.route(
      (url) => url.protocol !== "file:",
      async (route) => {
        const headers = await route.request().allHeaders();
        headers["sec-ch-ua"] = SEC_CH_UA;
        await route.continue({ headers });
      }
    );

    // Add cookies
    await context.addCookies(transformedCookies);

    return context;
  };

  const context = await getBrowserContext();

  const refreshSessionCookies = async (): Promise<void> => {
    rawCookieString = (await readFile(cookiePath, { encoding: "utf-8" }))
      .trim()
      .replaceAll("\n", " ");
    const refreshed = transformCookieString(rawCookieString);
    transformedCookies = refreshed.transformedCookies;
    processedCookieString = refreshed.processedCookieString;
    client.defaults.headers.Cookie = processedCookieString;
    await context.addCookies(transformedCookies);
  };

  saveOptions.refreshCookies = refreshSessionCookies;

  if (doCookieTest) {
    // no newline after write
    process.stdout.write("Attempting to log into PTS...");
    const cookieTestingPage = await context.newPage();
    await cookieTestingPage.goto(
      "https://www.fordtechservice.dealerconnection.com",
      { waitUntil: "load" }
    );
    if (cookieTestingPage.url().includes("subscriptionExpired")) {
      console.error(
        "Looks like your PTS subscription has expired, or cookies are stale. " +
          "Log into PTS in Chrome and run: node scripts/export-cookies-from-chrome.js"
      );
      const expiryDate = await cookieTestingPage.evaluate(
        'document.querySelector("#pts-page > ul > li > b")?.innerText?.trim()'
      );
      if (expiryDate) {
        console.error(expiryDate);
      }
      process.exit(1);
    } else if (
      !cookieTestingPage
        .url()
        .startsWith("https://www.fordtechservice.dealerconnection.com")
    ) {
      console.error("Failed to log in with the provided cookies.");
      process.exit(1);
    }
    console.log("ok!");
    try {
      const probeUrl = getConnectorProbeUrl(process.cwd());
      await probeConnectorAccess(cookieTestingPage, probeUrl);
      console.log("Connector access check: ok!");
    } catch (e) {
      if (e instanceof PtsAuthError) {
        console.error(`Connector access check failed: ${e.message}`);
        console.error(
          "Connector PDFs require a live PTS portal session. " +
            "Log into PTS in Chrome and run: node scripts/export-cookies-from-chrome.js"
        );
        process.exit(1);
      }
      throw e;
    }
    await cookieTestingPage.close();
  }

  if (connectorsOnly) {
    console.log("Connectors-only mode — skipping workshop manual");
  }

  if (runWorkshop) {
    if (parseInt(config.workshop.modelYear) >= 2003) {
      const browserPage = await context.newPage();
      await browserPage.route("FordEcat.jpg", (route) => route.abort());

      await modernWorkshop(config, outputPath, browserPage, saveOptions);
    } else {
      console.log(
        "Downloading pre-2003 workshop manual, please see README for details..."
      );

      if (
        config.pre_2003.alphabeticalIndexURL ===
        "https://www.fordservicecontent.com/pubs/content/....."
      ) {
        console.error(
          "Please set the URL for the pre-2003 alphabetical index in the config file."
        );
        process.exit(1);
      }

      await context.addCookies(transformedCookies);
      const browserPage = await context.newPage();

      await pre2003Workshop(
        config,
        outputPath,
        rawCookieString,
        browserPage,
        saveOptions
      );
    }

    console.log("Saved workshop manual!");
  } else {
    console.log("Skipping workshop manual download.");
  }

  if (runWiring) {
    if (connectorsOnly) {
      console.log("Connectors-only mode — skipping wiring diagram pages");
    } else {
      console.log("Saving wiring manual...");
    }

    await refreshSessionCookies();
    const wiringPage = await context.newPage();

    const wiringParams: WiringFetchParams = {
      ...config.wiring,
      book: config.workshop.WiringBookCode,
      contentlanguage: config.workshop.contentlanguage,
      contentmarket: config.workshop.contentmarket,
      languageCode: config.workshop.languageOdysseyCode,
    };

    const wiringTocPath = join(outputPath, "Wiring", "toc.json");
    let wiringToC;
    if (await fileExistsNonEmpty(wiringTocPath)) {
      console.log("Resuming wiring — using existing Wiring/toc.json");
      wiringToC = JSON.parse(await readFile(wiringTocPath, { encoding: "utf-8" }));
    } else if (connectorsOnly) {
      console.error(
        "Connectors-only mode requires existing Wiring/toc.json. Run a full wiring download first."
      );
      process.exit(1);
    } else {
      console.log("Fetching wiring table of contents...");
      wiringToC = await resolveWiringTableOfContents(
        wiringParams,
        captureGaps
      );
    }

    if (wiringToC) {
      await saveEntireWiring(
        outputPath,
        config.workshop,
        wiringParams,
        wiringToC,
        wiringPage,
        restArgs.ignoreSaveErrors,
        captureGaps,
        {
          connectorsOnly,
          refreshCookies: refreshSessionCookies,
        }
      );
    } else if (!connectorsOnly) {
      console.log(
        "Skipping wiring download — TOC unavailable (see capture-gaps.json)"
      );
    }
    await pruneOrphanCdpTabs().catch(() => undefined);
  } else {
    console.log("Skipping wiring manual download.");
  }

  console.log("Manual downloaded, closing browser");
  await context.close();
  await browser.close();

  const pruned = await captureGaps.pruneResolved();
  if (pruned > 0) {
    console.log(`Pruned ${pruned} resolved gap(s) from capture-gaps.json`);
  }
  await captureGaps.save();
  if (captureGaps.hasBlockingGaps()) {
    console.log(`Capture incomplete: ${captureGaps.summary()}`);
    console.log(`See ${join(outputPath, "capture-gaps.json")} for details`);
  } else if (captureGaps.hasGaps()) {
    console.log(
      `Capture complete for queue purposes (${captureGaps.blockingCount()} blocking gaps); informational gaps may remain in capture-gaps.json`
    );
  } else {
    console.log("Capture complete: no gaps recorded");
  }
}

async function pre2003Workshop(
  config: Config,
  outputPath: string,
  rawCookieString: string,
  browserPage: Page,
  saveOptions: SaveOptions
) {
  console.log("Downloading and processing alphabetical index...");
  const { documentList, pageHTML, modifiedHTML } =
    await fetchPre2003AlphabeticalIndex(
      config.pre_2003.alphabeticalIndexURL,
      rawCookieString
    );

  // usable ToC
  await writeFile(join(outputPath, "AAA_Table_Of_Contents.html"), modifiedHTML);
  // original ToC
  await writeFile(
    join(outputPath, "AA_originalTableOfContents.html"),
    pageHTML
  );
  // JSON ToC
  await writeFile(
    join(outputPath, "AA_alphabeticalIndex.json"),
    JSON.stringify(documentList, null, 2)
  );

  console.log("Saving manual files...");
  await saveEntirePre2003AlphabeticalIndex(
    outputPath,
    documentList,
    browserPage,
    saveOptions
  );
}

if (require.main === module) {
  const args = processCLIArgs();
  run(args)
    .then(() => process.exit(0))
    .catch((err) => {
      if (err instanceof PtsAuthError) {
        console.error(`PTS auth failure: ${err.message}`);
        process.exit(2);
      }
      logHttpError(err, "Download failed");
      process.exit(1);
    });
}

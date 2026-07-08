import {
  isBasicPage,
  isConnectors,
  isLocIndex,
  isPage,
  WiringFetchParams,
  WiringTableOfContentsEntry,
} from "./fetchTableOfContents";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { Page } from "playwright";
import { FetchManualPageParams } from "../workshop/fetchManualPage";
import savePage, { WiringFetchPageParams, WiringSaveContext } from "./savePage";
import saveConnector from "./saveConnector";
import { saveLocIndex } from "./saveLocIndex";
import CaptureGaps from "../captureGaps";
import { probeConnectorAccess } from "../ptsAuth";
import { getConnectorProbeUrl } from "../connectorProbeUrl";
import { createConnectorPage } from "../cdpConnectorPage";

export interface SaveEntireWiringOptions {
  connectorsOnly?: boolean;
  refreshCookies?: () => Promise<void>;
}

export default async function saveEntireWiring(
  path: string,
  fetchManualParams: FetchManualPageParams,
  fetchWiringParams: WiringFetchParams,
  toc: WiringTableOfContentsEntry[],
  browserPage: Page,
  ignoreSaveErrors: boolean = false,
  captureGaps?: CaptureGaps,
  options: SaveEntireWiringOptions = {}
) {
  const wiringPath = join(path, "Wiring");
  const ctx: WiringSaveContext = {
    outputRoot: path,
    captureGaps,
    refreshCookies: options.refreshCookies,
  };
  const connectorsOnly = !!options.connectorsOnly;

  try {
    await mkdir(wiringPath);
  } catch (e: any) {
    if (e.code !== "EEXIST") {
      throw e;
    }
  }

  let connectorPath = wiringPath;
  if (fetchWiringParams.bookType !== "basic") {
    try {
      connectorPath = join(wiringPath, "Connector Views");
      await mkdir(connectorPath);
    } catch (e: any) {
      if (e.code !== "EEXIST") {
        throw e;
      }
    }
  }

  if (!connectorsOnly) {
    await writeFile(join(wiringPath, "toc.json"), JSON.stringify(toc, null, 2));
  } else {
    console.log("Connectors-only mode — skipping wiring diagram pages");
  }

  let connectorPage: Page | null = null;
  let closeConnectorPage: (() => Promise<void>) | null = null;

  try {
  for (let i = 0; i < toc.length; i++) {
    const doc = toc[i];
    const sanitizedTitle = doc.Title.replace(/\//g, "-");
    const sectionPath = join(wiringPath, sanitizedTitle);

    if (connectorsOnly && !isConnectors(doc)) {
      continue;
    }

    try {
      await mkdir(sectionPath);
    } catch (e: any) {
      if (e.code !== "EEXIST") {
        throw e;
      }
    }

    const wiringFetchParams: WiringFetchPageParams = {
      ...fetchWiringParams,
      vehicleId: fetchManualParams.vehicleId,
      country: fetchManualParams.country,
    };

    try {
      if (isPage(doc) || isBasicPage(doc)) {
        if (connectorsOnly) continue;
        await savePage(
          wiringFetchParams,
          doc,
          browserPage,
          sectionPath,
          ignoreSaveErrors,
          ctx
        );
      } else if (isConnectors(doc)) {
        console.log("Preparing connector capture (fresh page + cookie refresh)...");
        await options.refreshCookies?.();

        if (!connectorPage) {
          const handle = await createConnectorPage(browserPage.context());
          connectorPage = handle.page;
          closeConnectorPage = handle.close;
          const probeUrl = getConnectorProbeUrl(process.cwd());
          console.log("Verifying connector portal access...");
          await probeConnectorAccess(connectorPage, probeUrl);
          console.log(
            `Connector portal access OK (${handle.usesCdp ? "CDP" : "headless"})`
          );
        }

        await saveConnector(
          wiringFetchParams,
          doc,
          connectorPage,
          connectorPath,
          ctx
        );
      } else if (isLocIndex(doc)) {
        if (connectorsOnly) continue;
        await saveLocIndex(wiringFetchParams, doc, connectorPath);
      } else {
        console.error(`Unrecognized wiring page type ${doc.Type}`, doc);
      }
    } catch (e: any) {
      if (ignoreSaveErrors) {
        console.error(
          `Skipping ${doc.Title} (${doc.Type}) due to error: ${e.message}`
        );
      } else {
        throw e;
      }
    }
  }
  } finally {
    if (closeConnectorPage) {
      await closeConnectorPage();
      closeConnectorPage = null;
      connectorPage = null;
    }
  }
}

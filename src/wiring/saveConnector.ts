import { WiringFetchPageParams, WiringSaveContext } from "./savePage";
import { WiringTableOfContentsEntry } from "./fetchTableOfContents";
import { Page } from "playwright";
import fetchConnectorList from "./fetchConnectorList";
import { sanitizeName, fileExistsNonEmpty } from "../utils";
import { join, relative } from "path";
import { writeFile } from "fs/promises";
import { gapReasonFromError, wiringConnectorGapId } from "../captureGaps";
import {
  CONNECTOR_MAX_CONSECUTIVE_AUTH_FAILURES,
  PtsAuthError,
  gapReasonFromPtsError,
  loadConnectorFacePage,
} from "../ptsAuth";

function relFromRoot(outputRoot: string, absolutePath: string): string {
  return relative(outputRoot, absolutePath).replace(/\\/g, "/");
}

function isAuthRelatedReason(reason: string): boolean {
  return reason === "auth" || reason === "subscription-expired";
}

export default async function saveConnector(
  params: WiringFetchPageParams,
  doc: WiringTableOfContentsEntry & { Type: "Connectors" },
  browserPage: Page,
  folderPath: string,
  ctx?: WiringSaveContext
): Promise<void> {
  const connectors = await fetchConnectorList(params);

  await writeFile(
    join(folderPath, "connectors.json"),
    JSON.stringify(connectors, null, 2)
  );

  let consecutiveAuthFailures = 0;

  for (const connector of connectors) {
    let title = `${sanitizeName(connector.Desc)} - ${connector.Name}`;
    if (title.length > 200) {
      title = `${title.slice(0, 150)} (truncated) - ${connector.Name}`;
    }
    const path = join(folderPath, `${title}.pdf`);
    const gapId = wiringConnectorGapId(doc.Number, connector.Name);

    if (await fileExistsNonEmpty(path)) {
      await ctx?.captureGaps?.resolve(gapId);
      console.log(
        `Skipping existing connector ${connector.Desc} (${connector.Name})`
      );
      continue;
    }

    console.log(`Saving connector ${connector.Desc} (${connector.Name})...`);

    const url = new URL(
      "https://www.fordtechservice.dealerconnection.com/wiring/face/"
    );
    url.searchParams.set("book", params.book);
    url.searchParams.set("vehicleId", params.vehicleId);
    url.searchParams.set("cell", doc.Number);
    url.searchParams.set("item", connector.FaceView);
    url.searchParams.set("bookType", params.bookType);
    url.searchParams.set("languageCode", params.languageCode);

    let loaded = false;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2 && !loaded; attempt++) {
      try {
        if (attempt === 1 && ctx?.refreshCookies) {
          console.log(
            `  Retrying connector ${connector.Name} after cookie refresh...`
          );
          await ctx.refreshCookies();
        } else if (attempt === 1) {
          console.log(
            `  Retrying connector ${connector.Name} with PTS session warmup...`
          );
        }

        await loadConnectorFacePage(browserPage, url.toString(), {
          warmup: attempt > 0,
        });
        loaded = true;
        consecutiveAuthFailures = 0;
      } catch (e) {
        lastError = e;
        const reason = gapReasonFromPtsError(e);
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(
          `  Connector load failed ${connector.Desc} (${connector.Name}): ${errMsg}`
        );

        if (isAuthRelatedReason(reason)) {
          consecutiveAuthFailures += 1;
          if (
            consecutiveAuthFailures >= CONNECTOR_MAX_CONSECUTIVE_AUTH_FAILURES
          ) {
            throw new PtsAuthError(
              `Connector capture stopped after ${consecutiveAuthFailures} consecutive auth failures (last: ${errMsg})`,
              reason
            );
          }
        }
        if (attempt === 1) {
          break;
        }
      }
    }

    if (!loaded) {
      const errMsg =
        lastError instanceof Error ? lastError.message : String(lastError);
      console.error(
        `Error loading connector ${connector.Desc} (${connector.Name}), skipping... (${errMsg})`
      );
      if (ctx?.captureGaps && ctx.outputRoot) {
        await ctx.captureGaps.record({
          id: gapId,
          section: "wiring-connector",
          name: `${connector.Desc} (${connector.Name})`,
          cell: doc.Number,
          relativePath: relFromRoot(ctx.outputRoot, path),
          expectedFile: relFromRoot(ctx.outputRoot, path),
          reason: gapReasonFromError(lastError),
          error: errMsg,
        });
      }
      await browserPage.waitForTimeout(500);
      continue;
    }

    try {
      try {
        await browserPage.waitForLoadState("networkidle", { timeout: 150 });
      } catch {
        // pass
      }

      await browserPage.evaluate(
        'document.getElementById("TerminalPartBtn")?.click()'
      );

      await browserPage.pdf({
        path: path,
        landscape: true,
      });
      await ctx?.captureGaps?.resolve(gapId);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(
        `Error saving connector PDF ${connector.Desc} (${connector.Name}), skipping... (${errMsg})`
      );
      if (ctx?.captureGaps && ctx.outputRoot) {
        await ctx.captureGaps.record({
          id: gapId,
          section: "wiring-connector",
          name: `${connector.Desc} (${connector.Name})`,
          cell: doc.Number,
          relativePath: relFromRoot(ctx.outputRoot, path),
          expectedFile: relFromRoot(ctx.outputRoot, path),
          reason: gapReasonFromError(e),
          error: errMsg,
        });
      }
    }
  }
}

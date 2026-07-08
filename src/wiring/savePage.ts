import { Page } from "playwright";
import { JSDOM } from "jsdom";
import fetchPageList from "./fetchPageList";
import {
  WiringFetchParams,
  WiringTableOfContentsEntry,
} from "./fetchTableOfContents";
import fetchSvg from "./fetchSvg";
import { join, relative, resolve } from "path";
import { pathToFileURL } from "url";
import { writeFile } from "fs/promises";
import { sanitizeName, fileExistsNonEmpty } from "../utils";
import CaptureGaps, {
  gapReasonFromError,
  wiringPageGapId,
} from "../captureGaps";

export interface WiringFetchPageParams extends WiringFetchParams {
  vehicleId: string;
  country: string;
}

export interface WiringSaveContext {
  outputRoot: string;
  captureGaps?: CaptureGaps;
  /** Re-read cookie file and apply to axios + browser context (connector phase). */
  refreshCookies?: () => Promise<void>;
}

function relFromRoot(outputRoot: string, absolutePath: string): string {
  return relative(outputRoot, absolutePath).replace(/\\/g, "/");
}

export default async function savePage(
  params: WiringFetchPageParams,
  doc:
    | (WiringTableOfContentsEntry & { Type: "Page" })
    | (WiringTableOfContentsEntry & { Type: "BasicPage" }),
  browserPage: Page,
  folderPath: string,
  ignoreSaveErrors: boolean = false,
  ctx?: WiringSaveContext
): Promise<void> {
  const pageList = await fetchPageList({
    ...params,
    cell: doc.Number,
    title: doc.Title,
    page: "1",
  });

  await writeFile(
    join(folderPath, "pageList.json"),
    JSON.stringify(pageList, null, 2)
  );

  for (const subPage of pageList as any[]) {
    let pageNumber: string | null = null;

    if (typeof subPage === "string") {
      pageNumber = subPage;
    } else if (subPage && typeof subPage === "object") {
      if ("page" in subPage && subPage.page) {
        pageNumber = String(subPage.page);
      } else if ("Value" in subPage && subPage.Value) {
        console.warn(`  Skipping legacy BasicPage subpage in ${doc.Title}`);
        continue;
      }
    }

    if (!pageNumber) {
      console.warn(
        `  Skipping unrecognized subpage format in ${doc.Title}: ${JSON.stringify(
          subPage
        )}`
      );
      continue;
    }

    let title = pageNumber;
    let pdfPath = join(folderPath, `${pageNumber}.pdf`);
    const gapId = wiringPageGapId(doc.Number, pageNumber);

    try {
      console.log(`Saving page ${pageNumber} of ${doc.Title}...`);

      const svg = await fetchSvg(
        doc.Number,
        pageNumber,
        params.environment,
        params.vehicleId,
        params.book,
        params.languageCode
      );

      const dom = new JSDOM(svg);
      const svgElement = dom.window.document.querySelector("svg");
      if (!svgElement) {
        const err = `No SVG element found in Wiring SVG for ${doc.Title} ${pageNumber}`;
        console.error(`  ${err}`);
        if (ignoreSaveErrors && ctx?.captureGaps && ctx.outputRoot) {
          const gapId = wiringPageGapId(doc.Number, pageNumber);
          await ctx.captureGaps.record({
            id: gapId,
            section: "wiring-page",
            name: `${doc.Title} page ${pageNumber}`,
            cell: doc.Number,
            page: pageNumber,
            relativePath: relFromRoot(ctx.outputRoot, folderPath),
            expectedFile: relFromRoot(
              ctx.outputRoot,
              join(folderPath, `${pageNumber}.pdf`)
            ),
            reason: "missing-svg",
            error: err,
          });
        }
        continue;
      }

      svgElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");

      const headerElement = dom.window.document.getElementById("Header");
      if (headerElement) {
        const child = headerElement.firstElementChild;
        if (child && child.textContent) {
          title += ` ${sanitizeName(child.textContent)}`;
        }
      }

      pdfPath = join(folderPath, `${title}.pdf`);

      if (await fileExistsNonEmpty(pdfPath)) {
        await ctx?.captureGaps?.resolve(gapId);
        console.log(`Skipping existing wiring page ${title} of ${doc.Title}`);
        continue;
      }

      const svgString = dom.serialize();
      const svgPath = join(folderPath, `${title}.svg`);
      await writeFile(svgPath, svgString);

      await browserPage.goto(pathToFileURL(svgPath).href);
      await browserPage.pdf({
        path: pdfPath,
        landscape: true,
      });
      await ctx?.captureGaps?.resolve(gapId);
    } catch (e: any) {
      if (ignoreSaveErrors) {
        console.error(
          `  Failed to save subpage ${pageNumber} of ${doc.Title}: ${e.message}`
        );
        if (ctx?.captureGaps && ctx.outputRoot) {
          const gapId = wiringPageGapId(doc.Number, pageNumber);
          await ctx.captureGaps.record({
            id: gapId,
            section: "wiring-page",
            name: `${doc.Title} page ${pageNumber}`,
            cell: doc.Number,
            page: pageNumber,
            relativePath: relFromRoot(ctx.outputRoot, folderPath),
            expectedFile: relFromRoot(ctx.outputRoot, pdfPath),
            reason: gapReasonFromError(e),
            error: e.message || String(e),
          });
        }
        continue;
      }
      throw e;
    }
  }
}

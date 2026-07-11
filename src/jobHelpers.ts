import { writeFile, readFile } from "fs/promises";
import { join } from "path";
import { fileExistsNonEmpty } from "./utils";
import fetchTreeAndCover, {
  FetchTreeAndCoverParams,
} from "./workshop/fetchTreeAndCover";
import fetchTableOfContents, {
  WiringFetchParams,
} from "./wiring/fetchTableOfContents";
import { Page } from "playwright";
import saveEntireManual, { SaveOptions } from "./workshop/saveEntireManual";
import { Config } from "./readConfig";
import { logHttpError } from "./logHttpError";
import CaptureGaps, {
  gapReasonFromError,
  isAuthClassGapReason,
  wiringPageGapId,
  workshopGapId,
} from "./captureGaps";

export async function modernWorkshop(
  config: Config,
  outputPath: string,
  browserPage: Page,
  saveOptions: SaveOptions
) {
  const tocPath = join(outputPath, "toc.json");
  const coverHtmlPath = join(outputPath, "cover.html");
  const workshopConfig = config.workshop as FetchTreeAndCoverParams;
  const tocFetchParams: FetchTreeAndCoverParams = {
    ...workshopConfig,
    CategoryDescription:
      workshopConfig.CategoryDescription ?? "GSIXML",
    category: workshopConfig.category ?? "33",
  };

  let tableOfContents: any;
  if (
    (await fileExistsNonEmpty(tocPath)) &&
    (await fileExistsNonEmpty(coverHtmlPath))
  ) {
    console.log("Resuming workshop — using existing toc.json and cover.html");
    tableOfContents = JSON.parse(await readFile(tocPath, { encoding: "utf-8" }));
  } else {
    console.log("Downloading and processing table of contents...");
    try {
      const fetched = await fetchTreeAndCover(tocFetchParams);
      tableOfContents = fetched.tableOfContents;
      await writeFile(tocPath, JSON.stringify(tableOfContents, null, 2));
      await writeFile(coverHtmlPath, fetched.pageHTML);
    } catch (e) {
      const reason = gapReasonFromError(e);
      if (isAuthClassGapReason(reason) && saveOptions.captureGaps) {
        logHttpError(e, "TreeAndCover");
        await saveOptions.captureGaps.record({
          id: workshopGapId("tree-and-cover"),
          section: "workshop",
          name: "Tree and Cover",
          relativePath: "toc.json",
          expectedFile: "toc.json",
          reason,
          error: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      throw e;
    }
  }

  console.log("Saving manual files...");
  await saveEntireManual(
    outputPath,
    tableOfContents,
    config.workshop,
    browserPage,
    saveOptions
  );
}

export async function resolveWiringTableOfContents(
  wiringParams: WiringFetchParams,
  captureGaps: CaptureGaps
): Promise<any[] | null> {
  try {
    return await fetchTableOfContents(wiringParams);
  } catch (e) {
    const reason = gapReasonFromError(e);
    if (isAuthClassGapReason(reason)) {
      logHttpError(e, "Wiring TOC");
      await captureGaps.record({
        id: wiringPageGapId("toc", wiringParams.book),
        section: "wiring-page",
        name: "Wiring TOC",
        cell: "toc",
        page: wiringParams.book,
        relativePath: "Wiring/toc.json",
        expectedFile: "Wiring/toc.json",
        reason,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
    throw e;
  }
}

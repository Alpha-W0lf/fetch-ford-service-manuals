import { mkdir, writeFile } from "fs/promises";
import { join, relative } from "path";
import fetchManualPage, { FetchManualPageParams } from "./fetchManualPage";
import client from "../client";
import { Page } from "playwright";
import { CLIArgs } from "../processCLIArgs";
import saveStream, { fileExistsNonEmpty, sanitizeName } from "../utils";
import { fileExistsAtRelPath, resolveExistingSubdir } from "../pathResolve";
import CaptureGaps, {
  gapReasonFromError,
  isAuthClassGapReason,
  workshopGapId,
} from "../captureGaps";
import { renderWorkshopPageToPdf } from "../renderHtmlToPdf";
import { logHttpError } from "../logHttpError";

export type SaveOptions = Pick<CLIArgs, "saveHTML" | "ignoreSaveErrors"> & {
  outputRoot: string;
  captureGaps?: CaptureGaps;
  refreshCookies?: () => Promise<void>;
  /** @internal consecutive auth-class failures (403, etc.) this run */
  authFailureStreak?: number;
  /** Set when workshop auth-budget stop fires; propagates through recursive TOC calls */
  authBudgetStopRequested?: boolean;
};

const AUTH_REFRESH_THRESHOLD = () => {
  const n = parseInt(process.env.WORKSHOP_AUTH_REFRESH_THRESHOLD || "5", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
};
const AUTH_STOP_THRESHOLD = () => {
  const n = parseInt(process.env.WORKSHOP_AUTH_STOP_THRESHOLD || "10", 10);
  const fallback = 10;
  const parsed = Number.isFinite(n) && n > 0 ? n : fallback;
  // Guide 04.4: stop must exceed refresh so cookie refresh can fire first.
  return Math.max(parsed, AUTH_REFRESH_THRESHOLD() + 1);
};
const AUTH_STOP_ENABLED = () => process.env.WORKSHOP_AUTH_STOP_ENABLED !== "0";

/**
 * Track auth-class streak, optionally refresh cookies once per run, and request
 * budget stop when threshold exceeded. Returns true when capture should stop.
 */
async function handleAuthClassFailure(
  options: SaveOptions,
  reason: string
): Promise<boolean> {
  if (!isAuthClassGapReason(reason)) {
    options.authFailureStreak = 0;
    return false;
  }

  options.authFailureStreak = (options.authFailureStreak || 0) + 1;

  if (
    options.authFailureStreak >= AUTH_REFRESH_THRESHOLD() &&
    options.refreshCookies
  ) {
    console.log(
      `[auth] ${options.authFailureStreak} consecutive auth failures — refreshing cookies from disk...`
    );
    await options.refreshCookies();
    options.authFailureStreak = 0;
    return false;
  }

  if (
    AUTH_STOP_ENABLED() &&
    options.authFailureStreak >= AUTH_STOP_THRESHOLD()
  ) {
    console.log(
      `[auth-budget-stop] ${options.authFailureStreak} consecutive auth-class failures — stopping workshop capture`
    );
    options.authBudgetStopRequested = true;
    return true;
  }

  return false;
}

function relFromRoot(outputRoot: string, absolutePath: string): string {
  return relative(outputRoot, absolutePath).replace(/\\/g, "/");
}

export default async function saveEntireManual(
  path: string,
  toc: any,
  fetchPageParams: FetchManualPageParams,
  browserPage: Page,
  options: SaveOptions
) {
  const exploded = Object.entries(toc);

  for (let i = 0; i < exploded.length; i++) {
    if (options.authBudgetStopRequested) break;

    const [name, docID] = exploded[i];

    if (typeof docID === "string" && docID.length > 0) {
      if (docID.startsWith("http") && docID.includes(".pdf")) {
        const filePath = join(
          path,
          `/${docID.slice(docID.lastIndexOf("/"))}`
        );
        const gapId = workshopGapId(`url:${docID}`);
        const relPath = relFromRoot(options.outputRoot, filePath);
        if (await fileExistsAtRelPath(options.outputRoot, relPath)) {
          await options.captureGaps?.resolve(gapId);
          console.log(`Skipping existing manual PDF ${name}`);
          continue;
        }

        console.log(`Downloading manual PDF ${name} ${docID}`);

        try {
          const pdfReq = await client({
            url: docID,
            responseType: "stream",
          });

          await saveStream(pdfReq.data, filePath);
          await options.captureGaps?.resolve(gapId);
          options.authFailureStreak = 0;
        } catch (e) {
          if (options.ignoreSaveErrors && options.captureGaps) {
            const reason = gapReasonFromError(e);
            logHttpError(e, `Error saving file ${name} with url ${docID}`);
            await options.captureGaps.record({
              id: gapId,
              section: "workshop",
              name,
              docId: docID,
              relativePath: relFromRoot(options.outputRoot, filePath),
              expectedFile: relFromRoot(options.outputRoot, filePath),
              reason,
              error: e instanceof Error ? e.message : String(e),
            });
            if (await handleAuthClassFailure(options, reason)) break;
          } else {
            logHttpError(e, `Error saving file ${name} with url ${docID}`);
          }
        }
        continue;
      } else if (docID.includes("/")) {
        console.error(`Skipping relative path ${docID} for name ${name}`);
        continue;
      }

      let filename = sanitizeName(name);
      if (filename.length > 200) {
        filename =
          filename.slice(0, 254 - 19 - docID.length) + ` (${docID} truncated)`;
        console.log(`-> Truncating filename, learn more in the README`);
      }

      const pdfPath = join(path, `/${filename}.pdf`);
      const htmlPath = join(path, `/${filename}.html`);
      const gapId = workshopGapId(docID);

      const relPdf = relFromRoot(options.outputRoot, pdfPath);
      if (
        (await fileExistsAtRelPath(options.outputRoot, relPdf)) &&
        (!options.saveHTML ||
          (await fileExistsAtRelPath(
            options.outputRoot,
            relFromRoot(options.outputRoot, htmlPath)
          )))
      ) {
        await options.captureGaps?.resolve(gapId);
        console.log(`Skipping existing manual page ${name} (docID: ${docID})`);
        continue;
      }

      console.log(
        `Downloading manual page ${name} as ${
          options.saveHTML ? "HTML, " : ""
        }PDF (docID: ${docID})`
      );

      try {
        const pageHTML = await fetchManualPage({
          ...fetchPageParams,
          searchNumber: docID,
        });

        if (options.saveHTML && !(await fileExistsNonEmpty(htmlPath))) {
          await writeFile(htmlPath, pageHTML);
        }

        if (await fileExistsAtRelPath(options.outputRoot, relPdf)) {
          await options.captureGaps?.resolve(gapId);
          continue;
        }

        await renderWorkshopPageToPdf(browserPage, pageHTML, pdfPath);
        await options.captureGaps?.resolve(gapId);
        options.authFailureStreak = 0;
      } catch (e) {
        if (options.ignoreSaveErrors) {
          logHttpError(
            e,
            `Continuing to download after error with ${name} (docID ${docID})`
          );
          if (options.captureGaps) {
            const reason = gapReasonFromError(e);
            await options.captureGaps.record({
              id: gapId,
              section: "workshop",
              name,
              docId: docID,
              relativePath: relFromRoot(options.outputRoot, pdfPath),
              expectedFile: relFromRoot(options.outputRoot, pdfPath),
              reason,
              error: e instanceof Error ? e.message : String(e),
            });
            if (await handleAuthClassFailure(options, reason)) break;
          }
        } else {
          logHttpError(
            e,
            `Encountered an error downloading ${name} (docID ${docID})`
          );
          throw e;
        }
      }
    } else {
      const newPath = await resolveExistingSubdir(path, name);

      try {
        await mkdir(newPath, { recursive: true });
      } catch (e) {
        if ((e as any).code === "EEXIST") {
          console.log(
            `Not creating folder ${newPath} because it already exists.`
          );
        }
      }

      await saveEntireManual(
        newPath,
        docID,
        fetchPageParams,
        browserPage,
        options
      );
      if (options.authBudgetStopRequested) break;
    }
  }
}

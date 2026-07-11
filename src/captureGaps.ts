import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import {
  hasQueueBlockingGaps,
  queueBlockingGapCount,
} from "../lib/capture-gaps-rules";
import { fileExistsAtRelPath } from "./pathResolve";

export const CAPTURE_GAPS_FILE = "capture-gaps.json";

export type CaptureSection =
  | "workshop"
  | "wiring-page"
  | "wiring-connector"
  | "wiring-locindex";

export interface CaptureGap {
  id: string;
  section: CaptureSection;
  name: string;
  docId?: string;
  cell?: string;
  page?: string;
  relativePath: string;
  expectedFile: string;
  reason: string;
  error: string;
  attempts: number;
  lastAttemptAt: string;
  source?: string;
}

export interface CaptureGapsFile {
  version: 1;
  updatedAt: string;
  gaps: CaptureGap[];
}

function emptyFile(): CaptureGapsFile {
  return { version: 1, updatedAt: new Date().toISOString(), gaps: [] };
}

export default class CaptureGaps {
  private data: CaptureGapsFile;
  private outputPath: string;

  private constructor(outputPath: string, data: CaptureGapsFile) {
    this.outputPath = outputPath;
    this.data = data;
  }

  static async load(outputPath: string): Promise<CaptureGaps> {
    const path = join(outputPath, CAPTURE_GAPS_FILE);
    try {
      const raw = await readFile(path, { encoding: "utf-8" });
      const parsed = JSON.parse(raw) as CaptureGapsFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.gaps)) {
        return new CaptureGaps(outputPath, emptyFile());
      }
      return new CaptureGaps(outputPath, parsed);
    } catch {
      return new CaptureGaps(outputPath, emptyFile());
    }
  }

  get count(): number {
    return this.data.gaps.length;
  }

  hasGaps(): boolean {
    return this.data.gaps.length > 0;
  }

  /** Gaps that should block verify/complete — excludes informational toc-audit, orphan log-backfill, and hybrid-eligible connector gaps. */
  hasBlockingGaps(): boolean {
    return hasQueueBlockingGaps(this.data.gaps);
  }

  blockingCount(): number {
    return queueBlockingGapCount(this.data.gaps);
  }

  async record(partial: Omit<CaptureGap, "attempts" | "lastAttemptAt">): Promise<void> {
    if (partial.expectedFile) {
      const exists = await fileExistsAtRelPath(this.outputPath, partial.expectedFile);
      if (exists) {
        await this.resolve(partial.id);
        return;
      }
    }
    const now = new Date().toISOString();
    const existing = this.data.gaps.find((g) => g.id === partial.id);
    if (existing) {
      existing.attempts += 1;
      existing.lastAttemptAt = now;
      existing.reason = partial.reason;
      existing.error = partial.error;
      existing.expectedFile = partial.expectedFile;
      existing.relativePath = partial.relativePath;
    } else {
      this.data.gaps.push({
        ...partial,
        attempts: 1,
        lastAttemptAt: now,
      });
    }
    await this.save();
  }

  async resolve(id: string): Promise<void> {
    const before = this.data.gaps.length;
    this.data.gaps = this.data.gaps.filter((g) => g.id !== id);
    if (this.data.gaps.length !== before) {
      await this.save();
    }
  }

  /** Drop gaps whose expected file now exists on disk. */
  async pruneResolved(): Promise<number> {
    const kept: CaptureGap[] = [];
    let removed = 0;
    for (const gap of this.data.gaps) {
      if (!gap.expectedFile) {
        kept.push(gap);
        continue;
      }
      if (await fileExistsAtRelPath(this.outputPath, gap.expectedFile)) {
        removed += 1;
      } else {
        kept.push(gap);
      }
    }
    if (removed > 0) {
      this.data.gaps = kept;
      await this.save();
    }
    return removed;
  }

  async save(): Promise<void> {
    this.data.updatedAt = new Date().toISOString();
    await writeFile(
      join(this.outputPath, CAPTURE_GAPS_FILE),
      JSON.stringify(this.data, null, 2) + "\n"
    );
  }

  summary(): string {
    if (!this.hasGaps()) return "no capture gaps";
    const bySection: Record<string, number> = {};
    for (const g of this.data.gaps) {
      bySection[g.section] = (bySection[g.section] || 0) + 1;
    }
    const parts = Object.entries(bySection).map(([k, v]) => `${k}:${v}`);
    return `${this.data.gaps.length} gap(s) (${parts.join(", ")})`;
  }
}

export function workshopGapId(docId: string): string {
  return `workshop:${docId}`;
}

export function wiringPageGapId(cell: string, page: string): string {
  return `wiring-page:${cell}:${page}`;
}

export function wiringConnectorGapId(
  cell: string,
  connectorName: string
): string {
  return `wiring-connector:${cell}:${connectorName}`;
}

export function gapReasonFromError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/subscriptionExpired|subscription.expired/i.test(msg)) {
    return "subscription-expired";
  }
  if (/PTS auth redirect|PTS auth failure|Failed to log in/i.test(msg)) {
    return "auth";
  }
  if (/timeout/i.test(msg)) return "timeout";
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg)) {
    return "network";
  }
  if (/403|access denied/i.test(msg)) return "auth";
  if (/browser has been closed/i.test(msg)) return "browser-closed";
  return "error";
}

export function isAuthClassGapReason(reason: string): boolean {
  return reason === "auth" || reason === "subscription-expired";
}

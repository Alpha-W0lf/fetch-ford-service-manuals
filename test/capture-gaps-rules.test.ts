import { describe, expect, it } from "vitest";
import {
  blockingGaps,
  hasQueueBlockingGaps,
  isBlockingGap,
  isHybridCompleteEligible,
  isOrphanLogBackfillGap,
  queueBlockingGapCount,
} from "../lib/capture-gaps-rules.js";
import fixture from "./fixtures/minimal-capture-gaps.json";

type GapRow = {
  label: string;
  gap: Record<string, unknown>;
  blocks: boolean;
};

const matrix: GapRow[] = [
  {
    label: "toc-audit any expectedFile",
    gap: {
      source: "toc-audit",
      expectedFile: "Workshop/x.pdf",
      attempts: 1,
    },
    blocks: false,
  },
  {
    label: "log-backfill missing expectedFile",
    gap: { source: "log-backfill", expectedFile: "", attempts: 1 },
    blocks: false,
  },
  {
    label: "log-backfill present expectedFile",
    gap: {
      source: "log-backfill",
      expectedFile: "Workshop/y.pdf",
      attempts: 1,
    },
    blocks: true,
  },
  {
    label: "connector-audit present",
    gap: {
      source: "connector-audit",
      expectedFile: "Wiring/A.pdf",
      attempts: 1,
    },
    blocks: true,
  },
  {
    label: "runtime undefined source",
    gap: { expectedFile: "Workshop/z.pdf", attempts: 1 },
    blocks: true,
  },
];

describe("capture-gaps-rules", () => {
  it.each(matrix)("$label — isBlockingGap", ({ gap, blocks }) => {
    expect(isBlockingGap(gap)).toBe(blocks);
  });

  it("isOrphanLogBackfillGap matches log-backfill without expectedFile", () => {
    expect(isOrphanLogBackfillGap({ source: "log-backfill" })).toBe(true);
    expect(
      isOrphanLogBackfillGap({
        source: "log-backfill",
        expectedFile: "x.pdf",
      })
    ).toBe(false);
  });

  it("fixture: orphan log-backfill does not block queue", () => {
    const gaps = fixture.gaps;
    expect(isOrphanLogBackfillGap(gaps[1])).toBe(true);
    expect(blockingGaps(gaps).map((g) => (g as { id: string }).id)).toEqual([
      "conn-1",
      "runtime-1",
    ]);
    expect(hasQueueBlockingGaps(gaps)).toBe(true);
  });

  it("hybrid-complete: connector gaps exhausted within limits", () => {
    const gaps = [
      {
        source: "connector-audit",
        expectedFile: "a.pdf",
        attempts: 3,
      },
      {
        source: "connector-audit",
        expectedFile: "b.pdf",
        attempts: 4,
      },
    ];
    expect(isHybridCompleteEligible(gaps, { maxGaps: 5, minAttempts: 3 })).toBe(
      true
    );
    expect(hasQueueBlockingGaps(gaps, { maxGaps: 5, minAttempts: 3 })).toBe(
      false
    );
    expect(queueBlockingGapCount(gaps, { maxGaps: 5, minAttempts: 3 })).toBe(0);
  });

  it("hybrid-complete: fails when too many blocking gaps", () => {
    const gaps = Array.from({ length: 6 }, (_, i) => ({
      source: "connector-audit",
      expectedFile: `${i}.pdf`,
      attempts: 5,
    }));
    expect(isHybridCompleteEligible(gaps, { maxGaps: 5, minAttempts: 3 })).toBe(
      false
    );
    expect(hasQueueBlockingGaps(gaps, { maxGaps: 5, minAttempts: 3 })).toBe(
      true
    );
  });

  it("hybrid-complete: fails when connector gap under min attempts", () => {
    const gaps = [
      {
        source: "connector-audit",
        expectedFile: "a.pdf",
        attempts: 2,
      },
    ];
    expect(isHybridCompleteEligible(gaps, { maxGaps: 5, minAttempts: 3 })).toBe(
      false
    );
  });

  it("hybrid-complete: orphan log-backfill ignored in blocking count", () => {
    const gaps = [
      { source: "log-backfill", expectedFile: "", attempts: 1, docId: "X" },
      {
        source: "connector-audit",
        expectedFile: "a.pdf",
        attempts: 3,
      },
    ];
    expect(isHybridCompleteEligible(gaps, { maxGaps: 5, minAttempts: 3 })).toBe(
      true
    );
    expect(hasQueueBlockingGaps(gaps, { maxGaps: 5, minAttempts: 3 })).toBe(
      false
    );
  });
});

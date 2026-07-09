export interface CaptureGapLike {
  source?: string;
  expectedFile?: string;
  attempts?: number;
}

export interface HybridCompleteOptions {
  maxGaps?: number;
  minAttempts?: number;
}

export function isOrphanLogBackfillGap(gap: CaptureGapLike): boolean;
export function isBlockingGap(gap: CaptureGapLike): boolean;
export function blockingGaps(gaps: CaptureGapLike[]): CaptureGapLike[];
export function isHybridCompleteEligible(
  gaps: CaptureGapLike[],
  options?: HybridCompleteOptions
): boolean;
export function hasQueueBlockingGaps(
  gaps: CaptureGapLike[],
  options?: HybridCompleteOptions
): boolean;
export function queueBlockingGapCount(
  gaps: CaptureGapLike[],
  options?: HybridCompleteOptions
): number;
export function parseHybridMaxGaps(): number;
export function parseHybridMinAttempts(): number;

export function shouldDeferOnLockAcquireFailure(
  deferOnLockBusy: boolean,
  acquired: boolean
): boolean;
export function shouldDeferOnLockTimeoutError(
  deferOnLockBusy: boolean,
  errMsg: string
): boolean;
export function lockWaitLabel(
  deferOnLockBusy: boolean,
  lockWaitMs: number
): string;

/**
 * Param capture CDP lock yield/defer policy (capture-params first vs retry pass).
 * Env: CDP_LOCK_YIELD_MS (first pass), CDP_LOCK_WAIT_MS (retry pass / connectors).
 */

const CDP_LOCK_TIMEOUT_RE = /Timed out waiting for CDP Chrome lock/i;

function shouldDeferOnLockAcquireFailure(deferOnLockBusy, acquired) {
  return Boolean(deferOnLockBusy && !acquired);
}

function shouldDeferOnLockTimeoutError(deferOnLockBusy, errMsg) {
  return Boolean(deferOnLockBusy && CDP_LOCK_TIMEOUT_RE.test(String(errMsg)));
}

function lockWaitLabel(deferOnLockBusy, lockWaitMs) {
  const sec = Math.round(lockWaitMs / 1000);
  return deferOnLockBusy
    ? `CDP yield ${sec}s then defer (CDP_LOCK_YIELD_MS first pass)`
    : `CDP wait up to ${sec}s (CDP_LOCK_WAIT_MS retry pass)`;
}

module.exports = {
  shouldDeferOnLockAcquireFailure,
  shouldDeferOnLockTimeoutError,
  lockWaitLabel,
  CDP_LOCK_TIMEOUT_RE,
};

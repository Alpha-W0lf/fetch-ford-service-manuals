/**
 * CDP tab URL classification for connector capture and safe prune rules.
 * Canonical contract: docs/reference/cdp_tab_hygiene.md
 */

const CONNECTOR_TAB_URL_RE = /\/wiring\/face\b/i;

function isConnectorCaptureTab(url) {
  return CONNECTOR_TAB_URL_RE.test(url);
}

function isChromeErrorTab(url) {
  return url.startsWith("chrome-error://");
}

function isDisposableTab(url) {
  return (
    url === "about:blank" ||
    isChromeErrorTab(url) ||
    isConnectorCaptureTab(url)
  );
}

/** Tabs safe to close while a connector job holds the CDP lock. */
function isSafePruneDuringConnectorJob(url) {
  return url === "about:blank" || isChromeErrorTab(url);
}

/**
 * Skip closing a disposable tab (idle prune loop).
 * Preserves live /wiring/face tabs and tabs in the kept connector set.
 */
function shouldSkipDisposableTabClose(url, isInKeptConnectorSet) {
  if (isInKeptConnectorSet) return true;
  if (isConnectorCaptureTab(url) && !isChromeErrorTab(url)) return true;
  return false;
}

function isConnectorJobActive(lockInfo) {
  return Boolean(lockInfo?.holder?.startsWith("connector-"));
}

module.exports = {
  isConnectorCaptureTab,
  isChromeErrorTab,
  isDisposableTab,
  isSafePruneDuringConnectorJob,
  shouldSkipDisposableTabClose,
  isConnectorJobActive,
};

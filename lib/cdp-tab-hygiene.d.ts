export function isConnectorCaptureTab(url: string): boolean;
export function isChromeErrorTab(url: string): boolean;
export function isDisposableTab(url: string): boolean;
export function isSafePruneDuringConnectorJob(url: string): boolean;
export function shouldSkipDisposableTabClose(
  url: string,
  isInKeptConnectorSet: boolean
): boolean;
export function isConnectorJobActive(
  lockInfo: { holder?: string } | null | undefined
): boolean;

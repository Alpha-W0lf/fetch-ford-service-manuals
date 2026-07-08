import { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

/** Per-request axios retries (not whole-job retries). */
const DEFAULT_MAX_RETRIES = parseInt(process.env.HTTP_MAX_RETRIES || "5", 10);
const DEFAULT_BASE_DELAY_MS = parseInt(
  process.env.HTTP_RETRY_BASE_DELAY_MS || "1000",
  10
);
const DEFAULT_MAX_DELAY_MS = parseInt(
  process.env.HTTP_RETRY_MAX_DELAY_MS || "30000",
  10
);
/** Stop retrying a single request after this much wall time (default 2 min). */
const DEFAULT_RETRY_BUDGET_MS = parseInt(
  process.env.HTTP_RETRY_BUDGET_MS || "120000",
  10
);

type RetryConfig = InternalAxiosRequestConfig & {
  __retryCount?: number;
  __retryStartedAt?: number;
};

const TRANSIENT_NETWORK_RE =
  /ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|socket hang up|network error|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION/i;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with full jitter (AWS/Google recommended).
 * Spreads retries across time and avoids synchronized retry storms.
 */
export function computeRetryDelayMs(attempt: number): number {
  const cap = Math.min(
    DEFAULT_BASE_DELAY_MS * 2 ** attempt,
    DEFAULT_MAX_DELAY_MS
  );
  return Math.floor(Math.random() * cap);
}

function parseRetryAfterMs(error: AxiosError): number | null {
  const header = error.response?.headers?.["retry-after"];
  if (!header) return null;
  const asNum = parseInt(String(header), 10);
  if (!Number.isNaN(asNum)) return asNum * 1000;
  const asDate = Date.parse(String(header));
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function retryBudgetExceeded(config: RetryConfig): boolean {
  const started = config.__retryStartedAt ?? Date.now();
  config.__retryStartedAt = started;
  return Date.now() - started >= DEFAULT_RETRY_BUDGET_MS;
}

/** True for blips worth retrying — not auth failures or client errors. */
export function isRetryableHttpError(error: unknown): boolean {
  if (error instanceof AxiosError) {
    if (!error.response) {
      return true;
    }
    const status = error.response.status;
    return (
      status === 408 ||
      status === 429 ||
      status === 502 ||
      status === 503 ||
      status === 504
    );
  }

  return isRetryableNetworkMessage(
    error instanceof Error ? error.message : String(error)
  );
}

export function isRetryableNetworkMessage(message: string): boolean {
  if (TRANSIENT_NETWORK_RE.test(message)) return true;
  // Playwright navigation timeouts only (not selector waits on an already-loaded page).
  if (/page\.goto:.*timeout/i.test(message)) return true;
  return false;
}

export interface TransientRetryOptions {
  maxRetries?: number;
  label?: string;
  /** Return false to fail immediately without further retries. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Generic retry wrapper for Playwright navigation and other async I/O.
 * Uses the same backoff policy as the axios interceptor.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: TransientRetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const label = options.label ?? "operation";
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      if (Date.now() - startedAt >= DEFAULT_RETRY_BUDGET_MS) break;
      if (options.shouldRetry && !options.shouldRetry(error, attempt)) break;
      if (!isRetryableHttpError(error) && !isRetryableNetworkMessage(
        error instanceof Error ? error.message : String(error)
      )) {
        break;
      }

      const delay = computeRetryDelayMs(attempt);
      console.warn(
        `Retry ${attempt + 1}/${maxRetries} in ${delay}ms — ${label}`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Axios response interceptor: retry transient network / 5xx errors with jittered backoff.
 * Auth failures (403, etc.) are not retried — handled by cookie refresh / circuit breaker.
 */
export function attachHttpRetryInterceptor(
  client: AxiosInstance,
  maxRetries: number = DEFAULT_MAX_RETRIES
): void {
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryConfig | undefined;
      if (!config) {
        return Promise.reject(error);
      }

      const retryCount = config.__retryCount ?? 0;
      if (
        retryCount >= maxRetries ||
        retryBudgetExceeded(config) ||
        !isRetryableHttpError(error)
      ) {
        return Promise.reject(error);
      }

      config.__retryCount = retryCount + 1;
      const retryAfter = parseRetryAfterMs(error);
      const delay = retryAfter ?? computeRetryDelayMs(retryCount);
      const method = (config.method || "get").toUpperCase();
      const url = config.url || "(unknown)";
      console.warn(
        `HTTP retry ${config.__retryCount}/${maxRetries} in ${delay}ms — ${method} ${url}`
      );

      await sleep(delay);
      return client.request(config);
    }
  );
}

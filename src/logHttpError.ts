import { AxiosError } from "axios";

/** Log HTTP failures without dumping cookies, sockets, or full axios config. */
export function logHttpError(err: unknown, context?: string): void {
  const prefix = context ? `${context}: ` : "";

  if (err instanceof AxiosError) {
    const method = err.config?.method?.toUpperCase() ?? "REQUEST";
    const url = err.config?.url ?? "(unknown url)";
    const status = err.response?.status;
    const statusText = err.response?.statusText;
    const body =
      typeof err.response?.data === "string" ? err.response.data : "";

    console.error(
      `${prefix}HTTP ${status ?? "?"} ${statusText ?? ""} — ${method} ${url}`.trim()
    );

    if (body.includes("Access Denied")) {
      console.error(`${prefix}Ford CDN returned Access Denied (auth or Akamai block)`);
    } else if (body) {
      const snippet = body.replace(/\s+/g, " ").slice(0, 160);
      console.error(`${prefix}Response: ${snippet}`);
    } else if (err.message) {
      console.error(`${prefix}${err.message}`);
    }
    return;
  }

  if (err instanceof Error) {
    console.error(`${prefix}${err.message}`);
    return;
  }

  console.error(`${prefix}${String(err)}`);
}

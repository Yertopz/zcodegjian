import {
  readContentLength,
  redactHeaders,
  type BrowserNetworkInternalEntry,
} from "./browserConsoleNetworkTypes.js";

/**
 * HAR 1.2 导出。只在用户显式导出时调用；默认脱敏敏感头。
 * 浅采集没有精确 timing 与响应体，因此只填可证明的字段，不编造缺失值。
 */
export function buildBrowserConsoleHar(
  entries: BrowserNetworkInternalEntry[],
  showSensitive: boolean,
): string {
  const har = {
    log: {
      version: "1.2",
      creator: { name: "ZCode Browser Console", version: "1" },
      entries: entries
        .filter((entry) => entry.resourceType !== "console-marker")
        .filter((entry) => entry.source === "webRequest" || entry.source === "cdp")
        .map((entry) => {
          const requestHeaders = toHarHeaders(redactHeaders(entry.requestHeaders, showSensitive));
          const responseHeaders = toHarHeaders(redactHeaders(entry.responseHeaders, showSensitive));
          const size = entry.size ?? readContentLength(entry.responseHeaders) ?? -1;
          const started = entry.startedAt;
          const ended = entry.completedAt ?? entry.responseStartedAt ?? started;
          return {
            startedDateTime: new Date(started).toISOString(),
            time: Math.max(0, ended - started),
            request: {
              method: entry.method || "GET",
              url: entry.url,
              httpVersion: entry.protocol ?? "HTTP/1.1",
              cookies: [],
              headers: requestHeaders,
              queryString: parseQueryString(entry.url),
              headersSize: -1,
              bodySize: -1,
            },
            response: {
              status: entry.statusCode ?? 0,
              statusText: entry.statusLine ?? entry.error ?? "",
              httpVersion: entry.protocol ?? "HTTP/1.1",
              cookies: [],
              headers: responseHeaders,
              content: { size, mimeType: mimeTypeOf(responseHeaders) },
              redirectURL: entry.redirectUrl ?? "",
              headersSize: -1,
              bodySize: size,
            },
            cache: {},
            timings: {
              send: 0,
              wait: Math.max(0, (entry.responseStartedAt ?? ended) - started),
              receive: Math.max(0, ended - (entry.responseStartedAt ?? ended)),
            },
          };
        }),
    },
  };
  return JSON.stringify(har, null, 2);
}

function toHarHeaders(
  headers: Record<string, string[]> | undefined,
): { name: string; value: string }[] {
  if (!headers) return [];
  const output: { name: string; value: string }[] = [];
  for (const [name, values] of Object.entries(headers)) {
    for (const value of values) output.push({ name, value });
  }
  return output;
}

function parseQueryString(url: string): { name: string; value: string }[] {
  try {
    const parsed = new URL(url);
    const output: { name: string; value: string }[] = [];
    parsed.searchParams.forEach((value, name) => output.push({ name, value }));
    return output;
  } catch {
    return [];
  }
}

function mimeTypeOf(headers: { name: string; value: string }[]): string {
  for (const header of headers) {
    if (header.name.toLowerCase() === "content-type") return header.value;
  }
  return "";
}

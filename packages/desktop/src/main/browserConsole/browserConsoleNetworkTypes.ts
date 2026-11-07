import {
  BROWSER_NETWORK_REDACTED_VALUE,
  BROWSER_NETWORK_SENSITIVE_HEADERS,
  type BrowserNetworkEntry,
} from "@zcode/shared";

/**
 * 网络采集的内部条目：保留原始请求/响应头（含敏感值），只在输出给 renderer 时脱敏。
 * 这样「显示敏感头」只是输出开关，不需要重新采集。
 */
export interface BrowserNetworkInternalEntry {
  id: string;
  instanceId: string;
  /** service worker / 早于 tab 登记的请求为 null。 */
  tabId: string | null;
  /** 采集时已知的 guest id；之后用于回填 tabId。 */
  webContentsId?: number;
  frameUrl?: string;
  source: "webRequest" | "cdp";
  method: string;
  url: string;
  resourceType: string;
  statusCode?: number;
  statusLine?: string;
  requestHeaders?: Record<string, string[]>;
  responseHeaders?: Record<string, string[]>;
  fromCache?: boolean;
  error?: string;
  startedAt: number;
  responseStartedAt?: number;
  completedAt?: number;
  size?: number;
  redirectUrl?: string;
  remoteAddress?: string;
  protocol?: string;
  bodyAvailable?: boolean;
  bodyUnavailableReason?: string;
  webSocketFrames?: {
    direction: "sent" | "received";
    opcode?: number;
    payload: string;
    at: number;
  }[];
}

const SENSITIVE = new Set<string>(BROWSER_NETWORK_SENSITIVE_HEADERS);

function redactHeaderValues(values: string[]): string[] {
  return values.map(() => BROWSER_NETWORK_REDACTED_VALUE);
}

export function redactHeaders(
  headers: Record<string, string[]> | undefined,
  showSensitive: boolean,
): Record<string, string[]> | undefined {
  if (!headers) return undefined;
  const output: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(headers)) {
    output[key] =
      !showSensitive && SENSITIVE.has(key.toLowerCase()) ? redactHeaderValues(values) : values;
  }
  return output;
}

function flattenHeaders(
  headers: Record<string, string[]> | undefined,
  showSensitive: boolean,
): Record<string, string> | undefined {
  const redacted = redactHeaders(headers, showSensitive);
  if (!redacted) return undefined;
  const output: Record<string, string> = {};
  for (const [key, values] of Object.entries(redacted)) output[key] = values.join(", ");
  return output;
}

export function toPublicNetworkEntry(
  entry: BrowserNetworkInternalEntry,
  showSensitive = false,
): BrowserNetworkEntry {
  return {
    id: entry.id,
    instanceId: entry.instanceId,
    tabId: entry.tabId,
    ...(entry.frameUrl ? { frameUrl: entry.frameUrl } : {}),
    source: entry.source,
    method: entry.method,
    url: entry.url,
    resourceType: entry.resourceType,
    ...(entry.statusCode === undefined ? {} : { statusCode: entry.statusCode }),
    ...(entry.statusLine ? { statusLine: entry.statusLine } : {}),
    ...(() => {
      const headers = flattenHeaders(entry.requestHeaders, showSensitive);
      return headers ? { requestHeaders: headers } : {};
    })(),
    ...(() => {
      const headers = redactHeaders(entry.responseHeaders, showSensitive);
      return headers ? { responseHeaders: headers } : {};
    })(),
    ...(entry.fromCache === undefined ? {} : { fromCache: entry.fromCache }),
    ...(entry.error ? { error: entry.error } : {}),
    startedAt: entry.startedAt,
    ...(entry.responseStartedAt === undefined
      ? {}
      : { responseStartedAt: entry.responseStartedAt }),
    ...(entry.completedAt === undefined ? {} : { completedAt: entry.completedAt }),
    ...(entry.size === undefined ? {} : { size: entry.size }),
    ...(entry.redirectUrl ? { redirectUrl: entry.redirectUrl } : {}),
    ...(entry.remoteAddress ? { remoteAddress: entry.remoteAddress } : {}),
    ...(entry.protocol ? { protocol: entry.protocol } : {}),
    ...(entry.bodyAvailable === undefined ? {} : { bodyAvailable: entry.bodyAvailable }),
    ...(entry.bodyUnavailableReason ? { bodyUnavailableReason: entry.bodyUnavailableReason } : {}),
    ...(entry.webSocketFrames ? { webSocketFrames: entry.webSocketFrames } : {}),
  };
}

/** 头对象来自 Electron webRequest；值可能是 string 或 string[]，统一成数组。 */
export function normalizeHeaders(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") output[key] = [raw];
    else if (Array.isArray(raw)) output[key] = raw.map((item) => String(item));
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export function readContentLength(
  headers: Record<string, string[]> | undefined,
): number | undefined {
  if (!headers) return undefined;
  for (const [key, values] of Object.entries(headers)) {
    if (key.toLowerCase() !== "content-length") continue;
    const parsed = Number(values[0]);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

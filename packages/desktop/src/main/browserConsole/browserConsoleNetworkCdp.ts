import {
  normalizeHeaders,
  readContentLength,
  type BrowserNetworkInternalEntry,
} from "./browserConsoleNetworkTypes.js";

/**
 * CDP `Network` 域事件 → 统一网络条目。
 *
 * 与浅采集使用同一套条目结构，但 id 加 `cdp:` 前缀避免两套 id 空间冲突；
 * 精确 timing / 远程 IP / 协议 / WebSocket 帧只有这里能提供。
 */

export interface BrowserConsoleCdpEntrySink {
  get(id: string): BrowserNetworkInternalEntry | undefined;
  upsert(entry: BrowserNetworkInternalEntry): void;
}

const MAX_WS_FRAMES = 50;
const MAX_WS_PAYLOAD_LENGTH = 4096;

function cdpId(requestId: string): string {
  return `cdp:${requestId}`;
}

function secondsToEpoch(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value * 1000 : fallback;
}

function stringRecordToHeaderArrays(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") output[key] = [raw];
    else if (Array.isArray(raw)) output[key] = raw.map((item) => String(item));
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function truncate(value: string): string {
  return value.length > MAX_WS_PAYLOAD_LENGTH
    ? `${value.slice(0, MAX_WS_PAYLOAD_LENGTH)}…(${value.length} chars)`
    : value;
}

export function handleBrowserConsoleCdpEvent(input: {
  sink: BrowserConsoleCdpEntrySink;
  instanceId: string;
  tabId: string;
  method: string;
  params: unknown;
  now?: number;
}): void {
  const { sink, instanceId, tabId } = input;
  const params = (input.params ?? {}) as Record<string, unknown>;
  const now = input.now ?? Date.now();
  const requestId = typeof params.requestId === "string" ? params.requestId : undefined;

  if (input.method === "Network.requestWillBeSent" && requestId) {
    const request = (params.request as Record<string, unknown> | undefined) ?? {};
    const id = cdpId(requestId);
    const redirect = params.redirectResponse as Record<string, unknown> | undefined;
    if (redirect) {
      const previous = sink.get(id);
      if (previous) {
        previous.statusCode = typeof redirect.status === "number" ? redirect.status : undefined;
        previous.statusLine =
          typeof redirect.statusText === "string" ? redirect.statusText : previous.statusLine;
        previous.redirectUrl = typeof request.url === "string" ? request.url : undefined;
        previous.responseHeaders = stringRecordToHeaderArrays(redirect.headers);
        previous.completedAt = now;
        sink.upsert(previous);
      }
    }
    sink.upsert({
      id,
      instanceId,
      tabId,
      source: "cdp",
      method: typeof request.method === "string" ? request.method : "GET",
      url: typeof request.url === "string" ? request.url : "",
      resourceType: typeof params.type === "string" ? params.type : "unknown",
      requestHeaders: stringRecordToHeaderArrays(request.headers),
      startedAt: secondsToEpoch(params.wallTime, now),
      ...(typeof params.documentURL === "string" ? { frameUrl: params.documentURL } : {}),
    });
    return;
  }

  if (!requestId) return;
  const entry = sink.get(cdpId(requestId));
  if (!entry) return;

  if (input.method === "Network.responseReceived") {
    const response = (params.response as Record<string, unknown> | undefined) ?? {};
    const mimeType = typeof response.mimeType === "string" ? response.mimeType : "";
    entry.statusCode = typeof response.status === "number" ? response.status : entry.statusCode;
    entry.statusLine =
      typeof response.statusText === "string" ? response.statusText : entry.statusLine;
    entry.responseHeaders = stringRecordToHeaderArrays(response.headers) ?? entry.responseHeaders;
    entry.fromCache = response.fromDiskCache === true || response.fromServiceWorker === true;
    entry.remoteAddress =
      typeof response.remoteIPAddress === "string" ? response.remoteIPAddress : entry.remoteAddress;
    entry.protocol = typeof response.protocol === "string" ? response.protocol : entry.protocol;
    entry.responseStartedAt = now;
    entry.size = readContentLength(entry.responseHeaders) ?? entry.size;
    entry.bodyAvailable = !mimeType.includes("text/event-stream");
    if (!entry.bodyAvailable) entry.bodyUnavailableReason = "事件流响应没有可读取的完整响应体";
    sink.upsert(entry);
    return;
  }

  if (input.method === "Network.loadingFinished") {
    entry.completedAt = now;
    entry.size =
      typeof params.encodedDataLength === "number" ? params.encodedDataLength : entry.size;
    sink.upsert(entry);
    return;
  }

  if (input.method === "Network.loadingFailed") {
    entry.completedAt = now;
    entry.error =
      typeof params.errorText === "string"
        ? params.errorText
        : typeof params.blockedReason === "string"
          ? params.blockedReason
          : "request failed";
    entry.bodyAvailable = false;
    entry.bodyUnavailableReason = "请求失败，没有响应体";
    sink.upsert(entry);
    return;
  }

  if (input.method === "Network.webSocketCreated") {
    sink.upsert({
      id: cdpId(requestId),
      instanceId,
      tabId,
      source: "cdp",
      method: "WS",
      url: typeof params.url === "string" ? params.url : "",
      resourceType: "WebSocket",
      startedAt: now,
      webSocketFrames: [],
      bodyAvailable: false,
      bodyUnavailableReason: "WebSocket 没有 HTTP 响应体",
    });
    return;
  }

  if (
    input.method === "Network.webSocketFrameSent" ||
    input.method === "Network.webSocketFrameReceived"
  ) {
    const response = (params.response as Record<string, unknown> | undefined) ?? {};
    const frames = entry.webSocketFrames ?? [];
    frames.push({
      direction: input.method === "Network.webSocketFrameSent" ? "sent" : "received",
      ...(typeof response.opcode === "number" ? { opcode: response.opcode } : {}),
      payload: truncate(typeof response.payloadData === "string" ? response.payloadData : ""),
      at: now,
    });
    entry.webSocketFrames = frames.slice(-MAX_WS_FRAMES);
    sink.upsert(entry);
    return;
  }

  if (input.method === "Network.webSocketClosed") {
    entry.completedAt = now;
    sink.upsert(entry);
  }
}

export function normalizeCdpHeaders(value: unknown): Record<string, string[]> | undefined {
  return normalizeHeaders(value);
}

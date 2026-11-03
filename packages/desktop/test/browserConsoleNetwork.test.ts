import assert from "node:assert/strict";
import test from "node:test";
import { BROWSER_NETWORK_REDACTED_VALUE } from "@zcode/shared";
import {
  normalizeHeaders,
  readContentLength,
  toPublicNetworkEntry,
  type BrowserNetworkInternalEntry,
} from "../src/main/browserConsole/browserConsoleNetworkTypes.js";
import { buildBrowserConsoleHar } from "../src/main/browserConsole/browserConsoleNetworkHar.js";
import { handleBrowserConsoleCdpEvent } from "../src/main/browserConsole/browserConsoleNetworkCdp.js";

function entry(overrides: Partial<BrowserNetworkInternalEntry> = {}): BrowserNetworkInternalEntry {
  return {
    id: "1",
    instanceId: "a",
    tabId: "t1",
    source: "webRequest",
    method: "GET",
    url: "https://example.com/a?x=1",
    resourceType: "xhr",
    statusCode: 200,
    requestHeaders: {
      cookie: ["session=secret"],
      accept: ["application/json"],
    },
    responseHeaders: {
      "set-cookie": ["token=secret"],
      "content-type": ["application/json"],
      "content-length": ["42"],
    },
    startedAt: 1_000,
    responseStartedAt: 1_050,
    completedAt: 1_100,
    ...overrides,
  };
}

test("network:默认脱敏敏感头,显式开关才返回原文", () => {
  const redacted = toPublicNetworkEntry(entry());
  assert.equal(redacted.requestHeaders?.cookie, BROWSER_NETWORK_REDACTED_VALUE);
  assert.equal(redacted.requestHeaders?.accept, "application/json");
  assert.deepEqual(redacted.responseHeaders?.["set-cookie"], [BROWSER_NETWORK_REDACTED_VALUE]);

  const visible = toPublicNetworkEntry(entry(), true);
  assert.equal(visible.requestHeaders?.cookie, "session=secret");
  assert.deepEqual(visible.responseHeaders?.["set-cookie"], ["token=secret"]);
});

test("network:头归一化与 content-length 读取", () => {
  assert.deepEqual(normalizeHeaders({ a: "1", b: ["2", "3"] }), { a: ["1"], b: ["2", "3"] });
  assert.equal(readContentLength({ "Content-Length": ["42"] }), 42);
  assert.equal(readContentLength({ x: ["1"] }), undefined);
});

test("har:导出包含请求/响应并排除分隔标记", () => {
  const raw = buildBrowserConsoleHar(
    [entry(), entry({ id: "m", resourceType: "console-marker", url: "deep-capture-on" })],
    false,
  );
  const har = JSON.parse(raw) as {
    log: { entries: Array<Record<string, unknown>> };
  };
  assert.equal(har.log.entries.length, 1);
  const record = har.log.entries[0] as {
    request: { headers: { name: string; value: string }[] };
    response: { status: number; content: { size: number } };
  };
  assert.equal(record.response.status, 200);
  assert.equal(record.response.content.size, 42);
  const cookie = record.request.headers.find((header) => header.name === "cookie");
  assert.equal(cookie?.value, BROWSER_NETWORK_REDACTED_VALUE);
});

test("cdp:请求/响应/失败事件合并到同一 requestId", () => {
  const entries = new Map<string, BrowserNetworkInternalEntry>();
  const sink = {
    get: (id: string) => entries.get(id),
    upsert: (value: BrowserNetworkInternalEntry) => entries.set(value.id, value),
  };
  handleBrowserConsoleCdpEvent({
    sink,
    instanceId: "a",
    tabId: "t1",
    method: "Network.requestWillBeSent",
    params: {
      requestId: "r1",
      type: "Fetch",
      wallTime: 1_700_000_000,
      request: { url: "https://example.com/api", method: "POST", headers: { accept: "*/*" } },
    },
  });
  handleBrowserConsoleCdpEvent({
    sink,
    instanceId: "a",
    tabId: "t1",
    method: "Network.responseReceived",
    params: {
      requestId: "r1",
      response: {
        status: 201,
        statusText: "Created",
        headers: { "content-type": "application/json", "content-length": "12" },
        remoteIPAddress: "203.0.113.9",
        protocol: "h2",
      },
    },
  });
  handleBrowserConsoleCdpEvent({
    sink,
    instanceId: "a",
    tabId: "t1",
    method: "Network.loadingFinished",
    params: { requestId: "r1", encodedDataLength: 12 },
  });
  const stored = entries.get("cdp:r1");
  assert.equal(stored?.statusCode, 201);
  assert.equal(stored?.remoteAddress, "203.0.113.9");
  assert.equal(stored?.protocol, "h2");
  assert.equal(stored?.size, 12);
  assert.equal(stored?.method, "POST");
  assert.equal(stored?.bodyAvailable, true);
});

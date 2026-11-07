import type { Session } from "electron";
import {
  BROWSER_NETWORK_BATCH_INTERVAL_MS,
  BROWSER_NETWORK_BATCH_MAX_ENTRIES,
  BROWSER_NETWORK_DEEP_MODE_SEPARATOR_ID,
  BROWSER_NETWORK_MAX_ENTRIES,
  PlatformChannels,
  type BrowserConsoleNetworkSnapshotResult,
  type BrowserNetworkEntry,
  type BrowserNetworkExportHarRequest,
  type BrowserNetworkHarExportResult,
} from "@zcode/shared";
import {
  findBrowserConsoleTabByWebContentsId,
  listBrowserConsoleTabs,
} from "./browserConsoleTabRegistry.js";
import { buildBrowserConsoleHar } from "./browserConsoleNetworkHar.js";
import { handleBrowserConsoleCdpEvent } from "./browserConsoleNetworkCdp.js";
import {
  normalizeHeaders,
  readContentLength,
  toPublicNetworkEntry,
  type BrowserNetworkInternalEntry,
} from "./browserConsoleNetworkTypes.js";

/**
 * 网络浅采集（`session.webRequest`，常开）。
 *
 * - 每个实例的 Session 只注册一次监听；缓冲按实例保存，环形淘汰。
 * - 事件在 main 侧批处理（100ms / 200 条）后推给订阅的 renderer。
 * - 深采集开启的 tab 不再写入浅采集条目，避免同一请求出现两条。
 * - 数据只给人类 UI；不向 Agent 暴露，也不落盘。
 */

interface InstanceState {
  entries: BrowserNetworkInternalEntry[];
  byId: Map<string, BrowserNetworkInternalEntry>;
  dropped: number;
  subscribers: Set<number>;
  dirty: Set<BrowserNetworkInternalEntry>;
  droppedSinceBatch: number;
  timer?: ReturnType<typeof setTimeout>;
  deepTabs: Set<string>;
  installed: boolean;
}

const states = new Map<string, InstanceState>();
const sessionPartitions = new Map<string, string>();

/**
 * 推送给 renderer 的出口由 index.ts 注入（避免本模块静态依赖 electron 的 webContents，
 * 使纯逻辑单测不需要 Electron 宿主）。
 */
let sendToWebContents: ((webContentsId: number, channel: string, payload: unknown) => void) | null =
  null;

export function setBrowserConsoleNetworkSender(
  sender: ((webContentsId: number, channel: string, payload: unknown) => void) | null,
): void {
  sendToWebContents = sender;
}

function stateFor(instanceId: string): InstanceState {
  let state = states.get(instanceId);
  if (!state) {
    state = {
      entries: [],
      byId: new Map(),
      dropped: 0,
      subscribers: new Set(),
      dirty: new Set(),
      droppedSinceBatch: 0,
      deepTabs: new Set(),
      installed: false,
    };
    states.set(instanceId, state);
  }
  return state;
}

function resolveTabId(webContentsId: number | undefined, instanceId: string): string | null {
  if (webContentsId === undefined || webContentsId <= 0) return null;
  const tab = findBrowserConsoleTabByWebContentsId(webContentsId);
  return tab && tab.instanceId === instanceId ? tab.tabId : null;
}

/** 快照/批次输出前按当前登记回填 tabId（首屏请求可能早于 attach）。 */
function refreshAttribution(entry: BrowserNetworkInternalEntry): void {
  if (entry.tabId) return;
  entry.tabId = resolveTabId(entry.webContentsId, entry.instanceId);
}

function upsert(state: InstanceState, entry: BrowserNetworkInternalEntry): void {
  refreshAttribution(entry);
  if (entry.tabId && state.deepTabs.has(entry.tabId) && entry.source === "webRequest") return;
  const existing = state.byId.get(entry.id);
  if (existing) {
    // 重定向复用同一个 webRequest id：把新阶段字段合并到同一条，不另造重复条目。
    Object.assign(existing, entry);
    state.dirty.add(existing);
    scheduleFlush(state);
    return;
  }
  state.entries.push(entry);
  state.byId.set(entry.id, entry);
  while (state.entries.length > BROWSER_NETWORK_MAX_ENTRIES) {
    const removed = state.entries.shift();
    if (!removed) break;
    state.byId.delete(removed.id);
    state.dropped += 1;
    state.droppedSinceBatch += 1;
  }
  state.dirty.add(entry);
  scheduleFlush(state);
}

function scheduleFlush(state: InstanceState): void {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = undefined;
    flush(state);
  }, BROWSER_NETWORK_BATCH_INTERVAL_MS);
  state.timer.unref?.();
}

function flush(state: InstanceState): void {
  if (state.subscribers.size === 0) {
    // 面板关闭时只保留缓冲，不推送；脏集合无需保留。
    state.dirty.clear();
    state.droppedSinceBatch = 0;
    return;
  }
  const entries = [...state.dirty].slice(0, BROWSER_NETWORK_BATCH_MAX_ENTRIES);
  if (entries.length === 0) {
    state.droppedSinceBatch = 0;
    return;
  }
  for (const entry of entries) state.dirty.delete(entry);
  const instanceId = entries[0]!.instanceId;
  const payload = {
    instanceId,
    entries: entries.map((entry) => toPublicNetworkEntry(entry)),
    dropped: state.droppedSinceBatch,
  };
  state.droppedSinceBatch = 0;
  for (const subscriber of state.subscribers) {
    if (!sendToWebContents) continue;
    sendToWebContents(subscriber, PlatformChannels.BrowserConsoleNetworkBatch, payload);
  }
  if (state.dirty.size > 0) scheduleFlush(state);
}

function installSessionListeners(instanceId: string, session: Session): void {
  const state = stateFor(instanceId);
  if (state.installed) return;

  session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    if (details.webContentsId !== undefined && details.webContentsId > 0) {
      upsert(state, {
        id: String(details.id),
        instanceId,
        tabId: null,
        webContentsId: details.webContentsId,
        source: "webRequest",
        method: details.method,
        url: details.url,
        resourceType: details.resourceType,
        startedAt: typeof details.timestamp === "number" ? details.timestamp * 1000 : Date.now(),
        ...(details.referrer ? { frameUrl: details.referrer } : {}),
      });
    }
    callback({});
  });

  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const entry = state.byId.get(String(details.id));
    if (entry) {
      entry.requestHeaders = normalizeHeaders(details.requestHeaders) ?? entry.requestHeaders;
      state.dirty.add(entry);
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  session.webRequest.onHeadersReceived((details, callback) => {
    const entry = state.byId.get(String(details.id));
    if (entry) {
      entry.statusCode = details.statusCode;
      entry.statusLine = details.statusLine;
      entry.responseHeaders = normalizeHeaders(details.responseHeaders) ?? entry.responseHeaders;
      entry.responseStartedAt = Date.now();
      entry.size = readContentLength(entry.responseHeaders) ?? entry.size;
      state.dirty.add(entry);
      scheduleFlush(state);
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  session.webRequest.onResponseStarted((details) => {
    const entry = state.byId.get(String(details.id));
    if (!entry) return;
    entry.responseStartedAt = entry.responseStartedAt ?? Date.now();
    entry.fromCache = details.fromCache === true;
    state.dirty.add(entry);
  });

  session.webRequest.onCompleted((details) => {
    const entry = state.byId.get(String(details.id));
    if (!entry) return;
    entry.completedAt = Date.now();
    entry.statusCode = details.statusCode ?? entry.statusCode;
    entry.responseHeaders = normalizeHeaders(details.responseHeaders) ?? entry.responseHeaders;
    entry.size = readContentLength(entry.responseHeaders) ?? entry.size;
    entry.fromCache = details.fromCache === true;
    state.dirty.add(entry);
    scheduleFlush(state);
  });

  session.webRequest.onErrorOccurred((details) => {
    const entry = state.byId.get(String(details.id));
    if (!entry) return;
    entry.completedAt = Date.now();
    entry.error = details.error;
    state.dirty.add(entry);
    scheduleFlush(state);
  });

  session.webRequest.onBeforeRedirect((details) => {
    const entry = state.byId.get(String(details.id));
    if (!entry) return;
    entry.redirectUrl = details.redirectURL;
    entry.statusCode = details.statusCode ?? entry.statusCode;
    entry.responseHeaders = normalizeHeaders(details.responseHeaders) ?? entry.responseHeaders;
    state.dirty.add(entry);
  });
  // 全部监听注册成功后才标记已安装；中途抛错时保留重试机会。
  state.installed = true;
}

export function ensureBrowserConsoleNetworkCapture(
  instanceId: string,
  partition: string,
  getSession: (partition: string) => Session,
): void {
  const state = stateFor(instanceId);
  if (state.installed) return;
  sessionPartitions.set(instanceId, partition);
  installSessionListeners(instanceId, getSession(partition));
}

export function subscribeBrowserConsoleNetwork(
  instanceId: string,
  subscriberWebContentsId: number,
  enabled: boolean,
): void {
  const state = stateFor(instanceId);
  if (enabled) state.subscribers.add(subscriberWebContentsId);
  else state.subscribers.delete(subscriberWebContentsId);
}

/** 订阅方 webContents 销毁时，把它从所有实例的订阅集合里清掉。 */
export function dropBrowserConsoleNetworkSubscriber(webContentsId: number): void {
  for (const state of states.values()) state.subscribers.delete(webContentsId);
}

export function snapshotBrowserConsoleNetwork(
  instanceId: string,
  tabId?: string | null,
  showSensitive = false,
): BrowserConsoleNetworkSnapshotResult {
  const state = stateFor(instanceId);
  const entries: BrowserNetworkEntry[] = [];
  for (const entry of state.entries) {
    refreshAttribution(entry);
    if (tabId && entry.tabId !== tabId) continue;
    if (entry.tabId && state.deepTabs.has(entry.tabId) && entry.source === "webRequest") continue;
    entries.push(toPublicNetworkEntry(entry, showSensitive));
  }
  return { entries, dropped: state.dropped };
}

export function clearBrowserConsoleNetwork(instanceId: string): void {
  const state = stateFor(instanceId);
  state.entries = [];
  state.byId.clear();
  state.dirty.clear();
  state.dropped = 0;
  state.droppedSinceBatch = 0;
}

export function exportBrowserConsoleHar(
  input: BrowserNetworkExportHarRequest,
): BrowserNetworkHarExportResult {
  const state = stateFor(input.instanceId);
  const entries = state.entries.filter((entry) => !input.tabId || entry.tabId === input.tabId);
  if (entries.length === 0) return { ok: false, error: "no_entries" };
  return {
    ok: true,
    har: buildBrowserConsoleHar(entries, input.showSensitiveHeaders === true),
  };
}

/** 深采集开关：切换时插入分隔标记，UI 不把浅/深数据误认为连续。 */
export function setBrowserConsoleDeepCaptureMode(
  instanceId: string,
  tabId: string,
  enabled: boolean,
): void {
  const state = stateFor(instanceId);
  if (enabled) state.deepTabs.add(tabId);
  else state.deepTabs.delete(tabId);
  const marker: BrowserNetworkInternalEntry = {
    id: `${BROWSER_NETWORK_DEEP_MODE_SEPARATOR_ID}:${Date.now()}`,
    instanceId,
    tabId,
    source: "cdp",
    method: "",
    url: enabled ? "deep-capture-on" : "deep-capture-off",
    resourceType: "console-marker",
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
  state.entries.push(marker);
  state.byId.set(marker.id, marker);
  state.dirty.add(marker);
}

export function handleBrowserConsoleDeepEvent(input: {
  instanceId: string;
  tabId: string;
  method: string;
  params: unknown;
}): void {
  const state = stateFor(input.instanceId);
  handleBrowserConsoleCdpEvent({
    sink: {
      get: (id) => state.byId.get(id),
      upsert: (entry) => {
        if (!state.byId.has(entry.id)) state.entries.push(entry);
        state.byId.set(entry.id, entry);
        state.dirty.add(entry);
        scheduleFlush(state);
      },
    },
    instanceId: input.instanceId,
    tabId: input.tabId,
    method: input.method,
    params: input.params,
  });
}

/** 实例删除或窗口关闭时释放监听与缓冲。Electron 不支持移除 webRequest 监听，只能丢弃状态。 */
export function disposeBrowserConsoleNetwork(instanceId: string): void {
  const state = states.get(instanceId);
  if (state?.timer) clearTimeout(state.timer);
  states.delete(instanceId);
  sessionPartitions.delete(instanceId);
}

export function listCapturedTabIds(instanceId: string): string[] {
  return listBrowserConsoleTabs(instanceId).map((tab) => tab.tabId);
}

/** 仅测试用：隔离模块级状态。 */
export function resetBrowserConsoleNetworkForTest(): void {
  for (const state of states.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  states.clear();
  sessionPartitions.clear();
  sendToWebContents = null;
}

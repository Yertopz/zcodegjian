import {
  MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE,
  type BrowserConsoleTabRegisterResult,
} from "@zcode/shared";

/**
 * 控制台标签归属登记表。
 *
 * renderer 拥有标签的 UI 与持久化；main 只登记「tabId 属于哪个实例 / 窗口 / guest」。
 * 这些事实用于两件安全相关的事：
 * 1. `<webview>` attach 前的一次性许可（tabId 必须已登记且实例/窗口一致）；
 * 2. `webRequest` / CDP 事件按 webContentsId 回填 tabId 时的归属判定。
 *
 * 模块级单例（与 partition guard 同款）：main 进程单实例，无并发写竞争。
 */

export interface BrowserConsoleTabRecord {
  tabId: string;
  instanceId: string;
  windowId: number;
  webContentsId?: number;
}

const tabs = new Map<string, BrowserConsoleTabRecord>();
/** 同一 guest 只能归属一个 tab；guest 换代时覆盖旧映射。 */
const webContentsToTab = new Map<number, string>();
/** 最近主动关闭的 console tab；用于阻止 guest 销毁引发的无意义重绑。 */
const closedTabIds = new Set<string>();
const MAX_CLOSED_TAB_IDS = 200;

export function registerBrowserConsoleTab(input: {
  tabId: string;
  instanceId: string;
  windowId: number;
}): BrowserConsoleTabRegisterResult {
  const existing = tabs.get(input.tabId);
  if (existing) {
    if (existing.instanceId !== input.instanceId || existing.windowId !== input.windowId) {
      return { ok: false, error: "tab_conflict" };
    }
    return { ok: true };
  }
  let count = 0;
  for (const tab of tabs.values()) {
    if (tab.instanceId === input.instanceId) count += 1;
  }
  if (count >= MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE) {
    return { ok: false, error: "limit_reached" };
  }
  tabs.set(input.tabId, {
    tabId: input.tabId,
    instanceId: input.instanceId,
    windowId: input.windowId,
  });
  closedTabIds.delete(input.tabId);
  return { ok: true };
}

export function unregisterBrowserConsoleTab(tabId: string): void {
  const tab = tabs.get(tabId);
  if (tab?.webContentsId !== undefined) {
    const mapped = webContentsToTab.get(tab.webContentsId);
    if (mapped === tabId) webContentsToTab.delete(tab.webContentsId);
  }
  tabs.delete(tabId);
  closedTabIds.add(tabId);
  while (closedTabIds.size > MAX_CLOSED_TAB_IDS) {
    const oldest = closedTabIds.values().next().value;
    if (oldest === undefined) break;
    closedTabIds.delete(oldest);
  }
}

/** main 收到 guest 重绑请求时，已主动关闭的 console tab 不得重新创建。 */
export function isBrowserConsoleTabClosed(tabId: string): boolean {
  return closedTabIds.has(tabId);
}

/** guest attach 成功后绑定 webContentsId；只接受已登记的 tab。 */
export function bindBrowserConsoleTabGuest(tabId: string, webContentsId: number): void {
  const tab = tabs.get(tabId);
  if (!tab || webContentsId <= 0) return;
  if (tab.webContentsId !== undefined && tab.webContentsId !== webContentsId) {
    const mapped = webContentsToTab.get(tab.webContentsId);
    if (mapped === tabId) webContentsToTab.delete(tab.webContentsId);
  }
  tab.webContentsId = webContentsId;
  webContentsToTab.set(webContentsId, tabId);
}

export function getBrowserConsoleTab(tabId: string): BrowserConsoleTabRecord | undefined {
  return tabs.get(tabId);
}

export function findBrowserConsoleTabByWebContentsId(
  webContentsId: number,
): BrowserConsoleTabRecord | undefined {
  const tabId = webContentsToTab.get(webContentsId);
  return tabId ? tabs.get(tabId) : undefined;
}

export function listBrowserConsoleTabs(instanceId?: string): BrowserConsoleTabRecord[] {
  return [...tabs.values()].filter((tab) => !instanceId || tab.instanceId === instanceId);
}

export function clearBrowserConsoleTabsForWindow(windowId: number): void {
  for (const tab of tabs.values()) {
    if (tab.windowId === windowId) unregisterBrowserConsoleTab(tab.tabId);
  }
}

export function clearBrowserConsoleTabsForInstance(instanceId: string): string[] {
  const removed: string[] = [];
  for (const tab of tabs.values()) {
    if (tab.instanceId === instanceId) {
      unregisterBrowserConsoleTab(tab.tabId);
      removed.push(tab.tabId);
    }
  }
  return removed;
}

/** 仅测试用：隔离模块级状态。 */
export function resetBrowserConsoleTabRegistryForTest(): void {
  tabs.clear();
  webContentsToTab.clear();
  closedTabIds.clear();
}

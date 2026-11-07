import { MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE, type BrowserInstanceRecord } from "@zcode/shared";
import type { BrowserConsoleTab } from "@/browser-console/browserConsoleTypes.js";

const CONSOLE_TABS_STORAGE_PREFIX = "zcode:browser-console-tabs:";

export interface ConsoleTabsSnapshot {
  instanceId: string;
  activeTabId: string | null;
  tabs: BrowserConsoleTab[];
}

/** 读取上次会话的标签壳；只恢复仍存在的实例，损坏数据直接丢弃。 */
export function readConsoleTabsSnapshot(
  workspaceKey: string,
  instances: BrowserInstanceRecord[],
): ConsoleTabsSnapshot | null {
  try {
    const raw = localStorage.getItem(`${CONSOLE_TABS_STORAGE_PREFIX}${workspaceKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      instanceId?: unknown;
      activeTabId?: unknown;
      tabs?: unknown;
    };
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    const known = new Set(instances.map((instance) => instance.id));
    const tabs: BrowserConsoleTab[] = [];
    for (const item of parsed.tabs) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      if (typeof value.id !== "string" || typeof value.instanceId !== "string") continue;
      if (!known.has(value.instanceId)) continue;
      if (
        tabs.filter((tab) => tab.instanceId === value.instanceId).length >=
        MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE
      )
        continue;
      tabs.push({
        id: value.id,
        instanceId: value.instanceId,
        url: typeof value.url === "string" ? value.url : "",
        title: typeof value.title === "string" ? value.title : "",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
      });
    }
    if (tabs.length === 0) return null;
    const instanceId =
      typeof parsed.instanceId === "string" && known.has(parsed.instanceId)
        ? parsed.instanceId
        : tabs[0]!.instanceId;
    const activeTabId =
      typeof parsed.activeTabId === "string" &&
      tabs.some((tab) => tab.id === parsed.activeTabId && tab.instanceId === instanceId)
        ? parsed.activeTabId
        : (tabs.find((tab) => tab.instanceId === instanceId)?.id ?? null);
    return { instanceId, activeTabId, tabs };
  } catch {
    return null;
  }
}

export function persistConsoleTabsSnapshot(
  workspaceKey: string,
  snapshot: {
    instanceId: string | null;
    activeTabId: string | null;
    tabs: BrowserConsoleTab[];
  },
): void {
  try {
    localStorage.setItem(
      `${CONSOLE_TABS_STORAGE_PREFIX}${workspaceKey}`,
      JSON.stringify({
        instanceId: snapshot.instanceId,
        activeTabId: snapshot.activeTabId,
        tabs: snapshot.tabs.map(({ id, instanceId, url, title }) => ({
          id,
          instanceId,
          url,
          title,
        })),
      }),
    );
  } catch {
    // 持久化失败不影响当前会话。
  }
}

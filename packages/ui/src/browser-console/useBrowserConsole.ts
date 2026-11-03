import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE,
  type BrowserInstanceColor,
  type BrowserInstanceRecord,
  type BrowserProxyConfig,
} from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import {
  type BrowserConsoleController,
  type BrowserConsoleTab,
} from "@/browser-console/browserConsoleTypes.js";
import { useBrowserConsoleInspector } from "@/browser-console/useBrowserConsoleInspector.js";
import { useBrowserConsoleNetwork } from "@/browser-console/useBrowserConsoleNetwork.js";
import {
  persistConsoleTabsSnapshot,
  readConsoleTabsSnapshot,
} from "@/browser-console/consoleTabsStorage.js";
import { useBrowserConsoleAgentControl } from "@/browser-console/useBrowserConsoleAgentControl.js";

export type {
  BrowserConsoleController,
  BrowserConsoleTab,
} from "@/browser-console/browserConsoleTypes.js";

/**
 * 浏览器控制台的 renderer 状态所有者。
 *
 * - 实例事实在 main（注册表）；这里只缓存展示需要的快照。
 * - 标签的 tabId / 激活态属于 renderer；创建 `<webview>` 前必须先向 main 登记归属。
 * - 网络数据与 AI 绑定分别由独立 hook / main 管理，本文件只做编排。
 */
export function useBrowserConsole(input: {
  workspaceKey: string;
  sessionId: string | null;
  isVisible: boolean;
}): BrowserConsoleController {
  const platform = usePlatform();
  const { workspaceKey, sessionId, isVisible } = input;
  const [instances, setInstances] = useState<BrowserInstanceRecord[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<BrowserConsoleTab[]>([]);
  const [activeTabByInstance, setActiveTabByInstance] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabsRef = useRef<BrowserConsoleTab[]>([]);
  const activeInstanceRef = useRef<string | null>(null);
  const webviewsRef = useRef(new Map<string, ElectronWebviewTag>());
  const initializedRef = useRef(false);
  const openTabRef = useRef<
    ((instanceId: string, url?: string, forcedTabId?: string) => Promise<string | null>) | null
  >(null);
  const closeTabRef = useRef<((tabId: string) => Promise<void>) | null>(null);
  tabsRef.current = tabs;
  activeInstanceRef.current = activeInstanceId;

  const activeInstance = useMemo(
    () => instances.find((instance) => instance.id === activeInstanceId) ?? null,
    [activeInstanceId, instances],
  );
  const instanceTabs = useMemo(
    () => tabs.filter((tab) => tab.instanceId === activeInstanceId),
    [tabs, activeInstanceId],
  );
  const activeTab = useMemo(() => {
    if (!activeInstanceId) return null;
    return (
      instanceTabs.find((tab) => tab.id === activeTabByInstance[activeInstanceId]) ??
      instanceTabs[0] ??
      null
    );
  }, [activeInstanceId, activeTabByInstance, instanceTabs]);

  const registerWebview = useCallback((tabId: string, node: ElectronWebviewTag | null) => {
    if (node) webviewsRef.current.set(tabId, node);
    else webviewsRef.current.delete(tabId);
  }, []);
  const getWebview = useCallback((tabId: string) => webviewsRef.current.get(tabId), []);

  const network = useBrowserConsoleNetwork({
    instanceId: activeInstanceId,
    activeTabId: activeTab?.id ?? null,
    isVisible,
  });
  const inspector = useBrowserConsoleInspector({ activeTab, getWebview });

  const refreshInstances = useCallback(async (): Promise<BrowserInstanceRecord[]> => {
    const next = (await platform.browserConsoleListInstances?.()) ?? [];
    setInstances(next);
    setActiveInstanceId((current) => {
      if (current && next.some((instance) => instance.id === current)) return current;
      return next[0]?.id ?? null;
    });
    return next;
  }, [platform]);

  /** 登记 + 申请一次性 attach 许可；新建与恢复共用同一顺序。 */
  const prepareTab = useCallback(
    async (tabId: string, instanceId: string): Promise<boolean> => {
      const registered = await platform.browserConsoleRegisterTab?.({ tabId, instanceId });
      if (!registered?.ok) return false;
      const prepared = await platform.browserConsolePrepareGuestAttach?.({ tabId, instanceId });
      if (!prepared?.ok) {
        await platform.browserConsoleUnregisterTab?.({ tabId });
        return false;
      }
      return true;
    },
    [platform],
  );

  const openTab = useCallback(
    async (instanceId: string, url?: string, forcedTabId?: string): Promise<string | null> => {
      const tabId =
        forcedTabId ??
        `console-tab:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const existing = tabsRef.current.filter((item) => item.instanceId === instanceId);
      if (
        !existing.some((item) => item.id === tabId) &&
        existing.length >= MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE
      ) {
        // 主进程 tab 注册表是最终判据；这里提前给出准确原因，避免用户只看到「无法创建网页视图」。
        setError(`每个实例最多 ${MAX_BROWSER_CONSOLE_TABS_PER_INSTANCE} 个标签`);
        return null;
      }
      if (!(await prepareTab(tabId, instanceId))) {
        setError("无法为实例创建网页视图");
        return null;
      }
      const tab: BrowserConsoleTab = {
        id: tabId,
        instanceId,
        url: url ?? "",
        title: "",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
      };
      setTabs((current) => [...current.filter((item) => item.id !== tabId), tab]);
      setActiveTabByInstance((current) => ({ ...current, [instanceId]: tabId }));
      setActiveInstanceId(instanceId);
      setError(null);
      return tabId;
    },
    [prepareTab],
  );
  openTabRef.current = openTab;

  useEffect(() => {
    if (!platform.browserConsoleListInstances || initializedRef.current) return;
    initializedRef.current = true;
    void refreshInstances().then(async (next) => {
      const first = next[0];
      if (!first) return;
      const restored = readConsoleTabsSnapshot(workspaceKey, next);
      const restoredActive =
        restored?.tabs.find((tab) => tab.id === restored.activeTabId) ?? restored?.tabs[0];
      if (
        restored &&
        restoredActive &&
        (await prepareTab(restoredActive.id, restoredActive.instanceId))
      ) {
        setTabs(restored.tabs.map((tab) => ({ ...tab, suspended: tab.id !== restoredActive.id })));
        setActiveTabByInstance({ [restoredActive.instanceId]: restoredActive.id });
        setActiveInstanceId(restoredActive.instanceId);
        return;
      }
      void openTabRef.current?.(first.id);
    });
  }, [platform, prepareTab, refreshInstances, workspaceKey]);

  const closeTab = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab) return;
      if (network.deepCaptureTabId === tabId) await network.releaseDeepCapture();
      await platform.browserConsoleUnregisterTab?.({ tabId });
      setTabs((current) => current.filter((item) => item.id !== tabId));
      setActiveTabByInstance((current) => {
        if (current[tab.instanceId] !== tabId) return current;
        const remaining = tabsRef.current.filter(
          (item) => item.instanceId === tab.instanceId && item.id !== tabId,
        );
        const next = { ...current };
        if (remaining[0]) next[tab.instanceId] = remaining[0].id;
        else delete next[tab.instanceId];
        return next;
      });
      webviewsRef.current.delete(tabId);
    },
    [network, platform],
  );
  closeTabRef.current = closeTab;

  useEffect(() => {
    if (!platform.onBrowserViewCloseTab) return;
    return platform.onBrowserViewCloseTab((payload) => {
      // main 因配额/崩溃收尾关闭了 tab：renderer 必须同步移除壳，不能留下死页面。
      if (tabsRef.current.some((tab) => tab.id === payload.tabId)) {
        void closeTabRef.current?.(payload.tabId);
      }
    });
  }, [platform]);

  const updateTab = useCallback((tabId: string, patch: Partial<BrowserConsoleTab>) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const activateTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab) return;
      setActiveTabByInstance((previous) => ({ ...previous, [tab.instanceId]: tabId }));
      setActiveInstanceId(tab.instanceId);
      if (!tab.suspended) return;
      // 启动恢复只保留逻辑壳；激活时才登记并挂载 guest。
      void (async () => {
        if (!(await prepareTab(tab.id, tab.instanceId))) {
          setError("恢复标签失败");
          return;
        }
        setTabs((current) =>
          current.map((item) => (item.id === tab.id ? { ...item, suspended: false } : item)),
        );
      })();
    },
    [prepareTab],
  );

  const selectInstance = useCallback(
    (instanceId: string) => {
      setActiveInstanceId(instanceId);
      const existing = tabsRef.current.filter((tab) => tab.instanceId === instanceId);
      if (existing.length === 0) {
        void openTab(instanceId);
        return;
      }
      if (!activeTabByInstance[instanceId] && existing[0]) {
        // 启动恢复的非活动实例只有逻辑壳：点实例时同时激活并恢复首个标签。
        activateTab(existing[0].id);
      }
    },
    [activateTab, activeTabByInstance, openTab],
  );

  const createInstance = useCallback(
    async (request: { name: string; color?: BrowserInstanceColor; proxy?: BrowserProxyConfig }) => {
      setBusy(true);
      try {
        const result = await platform.browserConsoleCreateInstance?.(request);
        if (!result?.ok || !result.instance) {
          setError(result?.error === "limit_reached" ? "已达到实例数量上限" : "创建实例失败");
          return;
        }
        await refreshInstances();
        await openTab(result.instance.id);
      } finally {
        setBusy(false);
      }
    },
    [openTab, platform, refreshInstances],
  );

  const updateInstance = useCallback(
    async (
      id: string,
      patch: { name?: string; color?: BrowserInstanceColor; proxy?: BrowserProxyConfig },
    ) => {
      const result = await platform.browserConsoleUpdateInstance?.({ id, ...patch });
      if (!result?.ok) {
        setError("更新实例失败");
        return;
      }
      await refreshInstances();
    },
    [platform, refreshInstances],
  );

  const deleteInstance = useCallback(
    async (id: string) => {
      for (const tab of tabsRef.current.filter((item) => item.instanceId === id)) {
        await platform.browserConsoleUnregisterTab?.({ tabId: tab.id });
        webviewsRef.current.delete(tab.id);
      }
      setTabs((current) => current.filter((tab) => tab.instanceId !== id));
      setActiveTabByInstance((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      // 先让 React 卸载 webview / 销毁 guest，再清 storage：Windows 上仍被 Chromium
      // 持有的文件会让清理留下半成品。
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const result = await platform.browserConsoleDeleteInstance?.({ id });
      if (!result?.ok) {
        setError(result?.error === "default_immutable" ? "默认实例不可删除" : "删除实例失败");
        return;
      }
      const nextInstances = await refreshInstances();
      const next = nextInstances.find((instance) => instance.id !== id);
      if (next) await openTab(next.id);
    },
    [openTab, platform, refreshInstances],
  );

  const clearInstanceData = useCallback(
    async (id: string, mode: "cache" | "all") => {
      const result = await platform.browserConsoleClearInstanceData?.({ instanceId: id, mode });
      setError(result?.success ? null : "清理实例数据失败");
    },
    [platform],
  );

  // AI 绑定：默认关闭；切换会话/工作区时重新读取（不持久化）。
  const openConsoleTab = useCallback(
    (instanceId: string, tabId: string) => {
      const existing = tabsRef.current.find((tab) => tab.id === tabId);
      if (!existing) {
        void openTabRef.current?.(instanceId, undefined, tabId);
        return;
      }
      // guest 崩溃后的重绑：重新登记许可并换一代 webview 节点。
      void (async () => {
        if (!(await prepareTab(tabId, instanceId))) return;
        setTabs((current) =>
          current.map((tab) =>
            tab.id === tabId
              ? { ...tab, suspended: false, generation: (tab.generation ?? 0) + 1 }
              : tab,
          ),
        );
      })();
    },
    [prepareTab],
  );
  const agent = useBrowserConsoleAgentControl({
    workspaceKey,
    sessionId,
    activeInstanceId,
    openConsoleTab,
    onError: setError,
  });

  // 标签壳持久化：只存 id/url/title，不落盘页面数据；重启后只挂载活动标签。
  useEffect(() => {
    if (!initializedRef.current) return;
    persistConsoleTabsSnapshot(workspaceKey, {
      instanceId: activeInstanceId,
      activeTabId: activeInstanceId ? (activeTabByInstance[activeInstanceId] ?? null) : null,
      tabs,
    });
  }, [activeInstanceId, activeTabByInstance, tabs, workspaceKey]);

  return {
    instances,
    activeInstanceId,
    activeInstance,
    tabs: instanceTabs,
    activeTab,
    busy,
    error,
    networkEntries: network.entries,
    networkDropped: network.dropped,
    showSensitiveHeaders: network.showSensitive,
    deepCaptureTabId: network.deepCaptureTabId,
    agentBindingInstanceId: agent.agentBindingInstanceId,
    aiControlEnabled: Boolean(
      activeInstanceId && agent.agentBindingInstanceId === activeInstanceId,
    ),
    selectInstance,
    openTab,
    closeTab,
    activateTab,
    updateTab,
    createInstance,
    updateInstance,
    deleteInstance,
    clearInstanceData,
    setShowSensitiveHeaders: network.setShowSensitive,
    refreshNetwork: network.refresh,
    clearNetwork: network.clear,
    exportHar: network.exportHar,
    setDeepCapture: network.setDeepCapture,
    releaseDeepCapture: network.releaseDeepCapture,
    getResponseBody: network.getResponseBody,
    setAiControl: agent.setAiControl,
    pageSnapshot: inspector.pageSnapshot,
    pickElement: inspector.pickElement,
    applyEdit: inspector.applyEdit,
    fillForm: inspector.fillForm,
    registerWebview,
    getWebview,
  };
}

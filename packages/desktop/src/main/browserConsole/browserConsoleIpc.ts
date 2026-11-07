import { BrowserWindow, ipcMain } from "electron";
import type { WebContents } from "electron";
import {
  PlatformChannels,
  browserConsoleClearInstanceDataRequestSchema,
  browserConsoleGetAgentBindingRequestSchema,
  browserConsolePrepareGuestAttachRequestSchema,
  browserConsoleSetAgentBindingRequestSchema,
  browserConsoleTabIdRequestSchema,
  browserConsoleTabRegisterRequestSchema,
  browserInstanceCreateRequestSchema,
  browserInstanceIdRequestSchema,
  browserInstanceUpdateRequestSchema,
  browserNetworkClearRequestSchema,
  browserNetworkDeepCaptureRequestSchema,
  browserNetworkExportHarRequestSchema,
  browserNetworkResponseBodyRequestSchema,
  browserNetworkSnapshotRequestSchema,
  browserNetworkSubscribeRequestSchema,
} from "@zcode/shared";
import { getBrowserConsoleRuntime } from "./browserConsoleRuntime.js";
import {
  getBrowserConsoleTab,
  listBrowserConsoleTabs,
  registerBrowserConsoleTab,
  unregisterBrowserConsoleTab,
} from "./browserConsoleTabRegistry.js";
import {
  clearBrowserConsoleNetwork,
  dropBrowserConsoleNetworkSubscriber,
  ensureBrowserConsoleNetworkCapture,
  exportBrowserConsoleHar,
  setBrowserConsoleDeepCaptureMode,
  snapshotBrowserConsoleNetwork,
  subscribeBrowserConsoleNetwork,
} from "./browserConsoleNetworkCapture.js";
import {
  acquireBrowserConsoleDeepCapture,
  applyBrowserConsoleTabBinding,
  getBrowserConsoleResponseBody,
  releaseBrowserConsoleClaimedTabs,
  releaseBrowserConsoleDeepCapture,
} from "./browserConsoleDeepCapture.js";
import {
  getBrowserConsoleAgentBinding,
  listBrowserConsoleAgentBindings,
  setBrowserConsoleAgentBinding,
} from "./browserConsoleAgentBinding.js";

/** 已挂过 `destroyed` 清理的订阅方（每个 webContents 只挂一次）。 */
const networkCleanupWired = new WeakSet<WebContents>();

/**
 * 控制台 IPC。所有入参在 main 重新解析（renderer 不可信），
 * 并且只暴露实例管理、tab 归属、网络与绑定，不暴露 Session 细节或代理凭据。
 */
export function registerBrowserConsoleIpcHandlers(logger: {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}): void {
  const runtimeOrNull = () => {
    try {
      return getBrowserConsoleRuntime();
    } catch {
      return null;
    }
  };

  ipcMain.handle(PlatformChannels.BrowserConsoleListInstances, () => {
    try {
      return getBrowserConsoleRuntime().list();
    } catch (error) {
      logger.warn("[browser-console] list unavailable", error);
      return [];
    }
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleCreateInstance, async (_event, raw: unknown) => {
    const parsed = browserInstanceCreateRequestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("[browser-console] ignored malformed create request");
      return { ok: false, error: "invalid_input" };
    }
    try {
      return await getBrowserConsoleRuntime().create(parsed.data);
    } catch (error) {
      logger.warn("[browser-console] create failed", error);
      return { ok: false, error: "session_unavailable" };
    }
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleUpdateInstance, async (_event, raw: unknown) => {
    const parsed = browserInstanceUpdateRequestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("[browser-console] ignored malformed update request");
      return { ok: false, error: "invalid_input" };
    }
    try {
      return await getBrowserConsoleRuntime().update(parsed.data);
    } catch (error) {
      logger.warn("[browser-console] update failed", error);
      return { ok: false, error: "session_unavailable" };
    }
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleDeleteInstance, async (_event, raw: unknown) => {
    const parsed = browserInstanceIdRequestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("[browser-console] ignored malformed delete request");
      return { ok: false, error: "invalid_input" };
    }
    try {
      const affected = listBrowserConsoleAgentBindings().filter(
        (binding) => binding.instanceId === parsed.data.id,
      );
      const result = await getBrowserConsoleRuntime().remove(parsed.data.id);
      if (result.ok) {
        notifyBindingChangedForInstance(affected);
      }
      return result;
    } catch (error) {
      logger.warn("[browser-console] delete failed", error);
      return { ok: false, error: "session_unavailable" };
    }
  });

  ipcMain.handle(PlatformChannels.BrowserConsolePrepareGuestAttach, async (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      return { ok: false, error: "invalid_input" };
    }
    const parsed = browserConsolePrepareGuestAttachRequestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("[browser-console] ignored malformed prepare-attach request");
      return { ok: false, error: "invalid_input" };
    }
    try {
      return await getBrowserConsoleRuntime().prepareGuestAttach({
        ...parsed.data,
        windowId: win.id,
      });
    } catch (error) {
      logger.warn("[browser-console] prepare attach failed", error);
      return { ok: false, error: "session_unavailable" };
    }
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleClearInstanceData, async (_event, raw: unknown) => {
    const parsed = browserConsoleClearInstanceDataRequestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("[browser-console] ignored malformed clear-data request");
      return { success: false, error: "invalid_input" };
    }
    try {
      return await getBrowserConsoleRuntime().clearInstanceData(parsed.data);
    } catch (error) {
      logger.warn("[browser-console] clear instance data failed", error);
      return { success: false, error: "browser_console_unavailable" };
    }
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleRegisterTab, (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const parsed = browserConsoleTabRegisterRequestSchema.safeParse(raw);
    if (!win || win.isDestroyed() || !parsed.success) {
      return { ok: false, error: "invalid_input" };
    }
    if (!runtimeOrNull()?.get(parsed.data.instanceId)) {
      return { ok: false, error: "not_found" };
    }
    return registerBrowserConsoleTab({ ...parsed.data, windowId: win.id });
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleUnregisterTab, (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const parsed = browserConsoleTabIdRequestSchema.safeParse(raw);
    if (!win || win.isDestroyed() || !parsed.success) return { ok: false };
    const tab = getBrowserConsoleTab(parsed.data.tabId);
    // 只有登记它的窗口能释放归属，避免另一个窗口误删别人的标签。
    if (tab && tab.windowId !== win.id) return { ok: false };
    if (tab) {
      setBrowserConsoleDeepCaptureMode(tab.instanceId, tab.tabId, false);
      releaseBrowserConsoleDeepCapture({ instanceId: tab.instanceId, tabId: tab.tabId });
    }
    unregisterBrowserConsoleTab(parsed.data.tabId);
    return { ok: true };
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleNetworkSubscribe, (event, raw: unknown) => {
    const parsed = browserNetworkSubscribeRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false };
    const instance = runtimeOrNull()?.get(parsed.data.instanceId);
    if (!instance) return { ok: false };
    try {
      ensureBrowserConsoleNetworkCapture(instance.id, instance.partition, (partition) =>
        getBrowserConsoleRuntime().partitionSession(partition),
      );
    } catch (error) {
      logger.warn("[browser-console] network capture unavailable", error);
    }
    subscribeBrowserConsoleNetwork(parsed.data.instanceId, event.sender.id, parsed.data.enabled);
    if (parsed.data.enabled && !networkCleanupWired.has(event.sender)) {
      // 每个 sender 只挂一次：反复开关面板不能叠加 destroyed 监听。
      networkCleanupWired.add(event.sender);
      const webContentsId = event.sender.id;
      event.sender.once("destroyed", () => {
        networkCleanupWired.delete(event.sender);
        dropBrowserConsoleNetworkSubscriber(webContentsId);
      });
    }
    return { ok: true };
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleNetworkSnapshot, (_event, raw: unknown) => {
    const parsed = browserNetworkSnapshotRequestSchema.safeParse(raw);
    if (!parsed.success) return { entries: [], dropped: 0 };
    return snapshotBrowserConsoleNetwork(
      parsed.data.instanceId,
      parsed.data.tabId ?? undefined,
      parsed.data.showSensitiveHeaders === true,
    );
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleNetworkClear, (_event, raw: unknown) => {
    const parsed = browserNetworkClearRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false };
    clearBrowserConsoleNetwork(parsed.data.instanceId);
    return { ok: true };
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleNetworkExportHar, (_event, raw: unknown) => {
    const parsed = browserNetworkExportHarRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "invalid_input" };
    return exportBrowserConsoleHar(parsed.data);
  });

  ipcMain.handle(
    PlatformChannels.BrowserConsoleAcquireDeepCapture,
    async (_event, raw: unknown) => {
      const parsed = browserNetworkDeepCaptureRequestSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: "not_found" };
      const result = await acquireBrowserConsoleDeepCapture(parsed.data);
      if (result.ok) {
        setBrowserConsoleDeepCaptureMode(parsed.data.instanceId, parsed.data.tabId, true);
      }
      return result;
    },
  );

  ipcMain.handle(PlatformChannels.BrowserConsoleReleaseDeepCapture, (_event, raw: unknown) => {
    const parsed = browserNetworkDeepCaptureRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false };
    const result = releaseBrowserConsoleDeepCapture(parsed.data);
    if (result.ok) {
      setBrowserConsoleDeepCaptureMode(parsed.data.instanceId, parsed.data.tabId, false);
    }
    return result;
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleGetResponseBody, async (_event, raw: unknown) => {
    const parsed = browserNetworkResponseBodyRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalid_input" };
    return getBrowserConsoleResponseBody(parsed.data);
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleSetAgentBinding, (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const parsed = browserConsoleSetAgentBindingRequestSchema.safeParse(raw);
    if (!win || win.isDestroyed() || !parsed.success) {
      return { ok: false, error: "not_found" };
    }
    if (parsed.data.instanceId !== null && !runtimeOrNull()?.get(parsed.data.instanceId)) {
      return { ok: false, error: "not_found" };
    }
    const previous = getBrowserConsoleAgentBinding({
      windowId: win.id,
      workspaceKey: parsed.data.workspaceKey,
      sessionId: parsed.data.sessionId,
    });
    setBrowserConsoleAgentBinding({
      windowId: win.id,
      workspaceKey: parsed.data.workspaceKey,
      sessionId: parsed.data.sessionId,
      instanceId: parsed.data.instanceId,
    });
    const apply = (instanceId: string, sessionId: string | null) => {
      for (const tab of listBrowserConsoleTabs(instanceId)) {
        if (tab.windowId !== win.id) continue;
        applyBrowserConsoleTabBinding(tab.tabId, {
          workspaceKey: parsed.data.workspaceKey,
          sessionId,
        });
      }
    };
    if (previous && previous.instanceId !== parsed.data.instanceId) {
      apply(previous.instanceId, null);
      if (parsed.data.instanceId === null) {
        releaseBrowserConsoleClaimedTabs(previous.instanceId);
      }
    }
    if (parsed.data.instanceId) apply(parsed.data.instanceId, parsed.data.sessionId);
    return { ok: true };
  });

  ipcMain.handle(PlatformChannels.BrowserConsoleGetAgentBinding, (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const parsed = browserConsoleGetAgentBindingRequestSchema.safeParse(raw);
    if (!win || win.isDestroyed() || !parsed.success) return { instanceId: null };
    const binding = getBrowserConsoleAgentBinding({ windowId: win.id, ...parsed.data });
    return { instanceId: binding?.instanceId ?? null };
  });
}

/** 实例删除后通知所有仍在展示旧开关的窗口回到关闭态。 */
function notifyBindingChangedForInstance(
  affected: ReturnType<typeof listBrowserConsoleAgentBindings>,
): void {
  for (const binding of affected) {
    const win = BrowserWindow.fromId(binding.windowId);
    if (!win || win.isDestroyed()) continue;
    win.webContents.send(PlatformChannels.BrowserConsoleAgentBindingChanged, {
      workspaceKey: binding.workspaceKey,
      sessionId: binding.sessionId,
      instanceId: null,
    });
  }
}

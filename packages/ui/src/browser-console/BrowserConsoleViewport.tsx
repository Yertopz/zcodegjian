import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserInstanceRecord } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";
import type { BrowserConsoleTab } from "@/browser-console/useBrowserConsole.js";

/**
 * 控制台 webview 宿主。
 *
 * 每个标签保持自己的 `<webview>` 节点常驻（仅用 CSS 隐藏非激活标签），
 * 这样切标签 / 切回对话都不会销毁 guest —— 页面状态与 AI 操作连续性都依赖这一点。
 * 创建节点前 tab 已在 main 登记并取得一次性 attach 许可（见 `openTab`）。
 */
export function BrowserConsoleViewport({
  tab,
  instance,
  isActive,
  isVisible,
  workspaceKey,
  sessionId,
  aiControlEnabled,
  lastReportedRef,
  onTabPatch,
  onWebviewRef,
}: {
  tab: BrowserConsoleTab;
  instance: BrowserInstanceRecord;
  isActive: boolean;
  isVisible: boolean;
  workspaceKey: string;
  sessionId: string | null;
  aiControlEnabled: boolean;
  lastReportedRef: React.MutableRefObject<Map<string, string>>;
  onTabPatch: (tabId: string, patch: Partial<BrowserConsoleTab>) => void;
  onWebviewRef: (tabId: string, node: ElectronWebviewTag | null) => void;
}): React.JSX.Element {
  const platform = usePlatform();
  const [node, setNode] = useState<ElectronWebviewTag | null>(null);
  // 首次挂载的 URL 固定下来：后续 tab.url 变化只用于地址栏，不能回写 `<webview src>`，
  // 否则 React 每次导航后重设 src 会触发额外导航（页面自刷新循环）。
  const initialSrcRef = useRef(tab.url || "about:blank");
  const nodeRef = useRef<ElectronWebviewTag | null>(null);
  const reportGuest = useCallback(
    (active: boolean) => {
      const webview = nodeRef.current;
      if (!webview || typeof webview.getWebContentsId !== "function") return;
      let webContentsId = 0;
      try {
        webContentsId = webview.getWebContentsId();
      } catch {
        return;
      }
      if (webContentsId <= 0) return;
      onTabPatch(tab.id, { webContentsId });
      const fingerprint = JSON.stringify({
        webContentsId,
        active,
        sessionId: aiControlEnabled ? sessionId : null,
      });
      if (lastReportedRef.current.get(tab.id) === fingerprint) return;
      lastReportedRef.current.set(tab.id, fingerprint);
      void platform
        .browserViewAttachGuest?.({
          key: tab.id,
          webContentsId,
          active,
          workspaceKey,
          consoleInstanceId: tab.instanceId,
          ...(aiControlEnabled && sessionId ? { sessionId } : {}),
        })
        .then((result) => {
          if (result && !result.ok) {
            logger.warn("[browser-console] guest attach rejected", {
              tabId: tab.id,
              reason: result.reason,
            });
            lastReportedRef.current.delete(tab.id);
          }
        })
        .catch((error: unknown) => {
          logger.warn("[browser-console] guest attach failed", {
            tabId: tab.id,
            error: error instanceof Error ? error.message : String(error),
          });
          lastReportedRef.current.delete(tab.id);
        });
    },
    [aiControlEnabled, lastReportedRef, platform, sessionId, tab.id, tab.instanceId, workspaceKey],
  );

  const handleRef = useCallback(
    (next: ElectronWebviewTag | null) => {
      nodeRef.current = next;
      setNode(next);
      onWebviewRef(tab.id, next);
    },
    [onWebviewRef, tab.id],
  );

  useEffect(() => {
    if (!node) return;
    const handleDidAttach = () => reportGuest(isActive);
    const handleDomReady = () => {
      reportGuest(isActive);
      try {
        const url = node.getURL();
        if (url && url !== "about:blank") {
          onTabPatch(tab.id, {
            url,
            title: node.getTitle(),
            isLoading: false,
            canGoBack: node.canGoBack(),
            canGoForward: node.canGoForward(),
          });
        }
      } catch {
        // 未 attach 时读取状态会抛错；等下一次事件即可。
      }
    };
    const handleTitle = (event: Event) => {
      const title = (event as Event & { title?: string }).title;
      if (typeof title === "string") onTabPatch(tab.id, { title });
    };
    const handleNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (!url) return;
      let canGoBack = false;
      let canGoForward = false;
      try {
        canGoBack = node.canGoBack();
        canGoForward = node.canGoForward();
      } catch {
        // ignore
      }
      onTabPatch(tab.id, {
        url,
        canGoBack,
        canGoForward,
      });
    };
    const handleStart = () => onTabPatch(tab.id, { isLoading: true, errorMessage: undefined });
    const handleStop = () => {
      let canGoBack = false;
      let canGoForward = false;
      try {
        canGoBack = node.canGoBack();
        canGoForward = node.canGoForward();
      } catch {
        // ignore
      }
      onTabPatch(tab.id, { isLoading: false, canGoBack, canGoForward });
    };
    const handleFail = (event: Event) => {
      const detail = event as Event & { errorDescription?: string; validatedURL?: string };
      // 用户主动停止导航会以 ERR_ABORTED 结束；这不是错误态。
      if (detail.errorDescription?.includes("ERR_ABORTED")) return;
      onTabPatch(tab.id, {
        isLoading: false,
        errorMessage: detail.errorDescription ?? "页面加载失败",
      });
    };
    node.addEventListener("did-attach", handleDidAttach);
    node.addEventListener("dom-ready", handleDomReady);
    node.addEventListener("page-title-updated", handleTitle);
    node.addEventListener("did-navigate", handleNavigate);
    node.addEventListener("did-navigate-in-page", handleNavigate);
    node.addEventListener("did-start-loading", handleStart);
    node.addEventListener("did-stop-loading", handleStop);
    node.addEventListener("did-fail-load", handleFail);
    return () => {
      node.removeEventListener("did-attach", handleDidAttach);
      node.removeEventListener("dom-ready", handleDomReady);
      node.removeEventListener("page-title-updated", handleTitle);
      node.removeEventListener("did-navigate", handleNavigate);
      node.removeEventListener("did-navigate-in-page", handleNavigate);
      node.removeEventListener("did-start-loading", handleStart);
      node.removeEventListener("did-stop-loading", handleStop);
      node.removeEventListener("did-fail-load", handleFail);
    };
  }, [isActive, node, onTabPatch, reportGuest, tab.id]);

  // 激活态变化要同步给 main，保证无 tabId 的 Agent 命令落到用户正在看的页面。
  useEffect(() => {
    reportGuest(isActive && isVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportGuest 已含全部依赖
  }, [isActive, isVisible]);

  return (
    <div
      className={cn(
        "relative h-full min-h-0 w-full flex-1 overflow-hidden bg-background",
        isActive ? "flex" : "hidden",
      )}
    >
      {tab.errorMessage ? (
        <div
          role="alert"
          className="absolute inset-x-3 top-3 z-10 rounded-lg border border-warning/40 bg-popover px-3 py-2 text-ui-base text-foreground shadow-sm"
        >
          {tab.errorMessage}
        </div>
      ) : null}
      <webview
        ref={handleRef}
        src={initialSrcRef.current}
        partition={instance.partition}
        allowpopups={"" as unknown as boolean}
        nodeintegrationinsubframes="true"
        data-browser-console-tab={tab.id}
        className="h-full min-h-0 w-full"
        style={{ backgroundColor: "#fff" }}
      />
    </div>
  );
}

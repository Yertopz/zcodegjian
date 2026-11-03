import { createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IPlatformService } from "@zcode/shared";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { useBrowserConsole } from "../../src/browser-console/useBrowserConsole.js";
import { BrowserConsoleViewport } from "../../src/browser-console/BrowserConsoleViewport.js";

const listeners = new Map<string, Set<(payload: unknown) => void>>();
const subscribe = (name: string) => (listener: (payload: unknown) => void) => {
  const handlers = listeners.get(name) ?? new Set();
  listeners.set(name, handlers);
  handlers.add(listener);
  return () => handlers.delete(listener);
};
const instance = {
  id: "background-test",
  name: "Background test",
  partition: "zcode-browser-background-test",
};
const platform = {
  browserConsoleListInstances: async () => [instance],
  browserConsoleGetAgentBinding: async () => ({ instanceId: instance.id }),
  browserConsoleRegisterTab: async () => ({ ok: true }),
  browserConsolePrepareGuestAttach: async () => ({ ok: true }),
  browserViewAttachGuest: async () => ({ ok: true }),
  onBrowserConsoleOpenTab: subscribe("open"),
  onBrowserViewVisibility: subscribe("visibility"),
} as unknown as IPlatformService;

function Harness() {
  const [view, setView] = useState("chat");
  const lastReportedRef = useRef(new Map<string, string>());
  // 保留旧导航回调作为回归探针：AI 事件调用它时，真实 React 页面就会离开对话。
  const input = {
    workspaceKey: "/background-test",
    sessionId: "test-session",
    isVisible: view === "browser",
    onRequestOpen: () => setView("browser"),
  };
  const controller = useBrowserConsole(input);
  return (
    <>
      <button onClick={() => setView("browser")}>Open browser</button>
      <button onClick={() => setView("chat")}>Return to chat</button>
      <textarea aria-label="Conversation draft" hidden={view !== "chat"} />
      <output data-testid="view">{view}</output>
      <output data-testid="bound">{String(controller.aiControlEnabled)}</output>
      <div hidden={view !== "browser"}>
        {controller.tabs.map((tab) => (
          <BrowserConsoleViewport
            key={`${tab.id}:${tab.generation ?? 0}`}
            tab={tab}
            instance={controller.activeInstance!}
            isActive={tab.id === controller.activeTab?.id}
            isVisible={view === "browser"}
            workspaceKey={input.workspaceKey}
            sessionId={input.sessionId}
            aiControlEnabled={controller.aiControlEnabled}
            lastReportedRef={lastReportedRef}
            onTabPatch={controller.updateTab}
            onWebviewRef={controller.registerWebview}
          />
        ))}
      </div>
    </>
  );
}

Object.assign(window, {
  browserBackgroundTest: {
    emit: (name: string, payload: unknown) => {
      for (const listener of listeners.get(name) ?? []) listener(payload);
    },
  },
});
createRoot(document.getElementById("root")!).render(
  createElement(PlatformProvider, { platform, children: createElement(Harness) }),
);

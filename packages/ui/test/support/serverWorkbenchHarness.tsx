import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { ServerWorkbenchView } from "../../src/server-workbench/ServerWorkbenchView.js";
import { ServerSidebarEntry } from "../../src/server-workbench/ServerSidebarEntry.js";
import { useServerWorkbench } from "../../src/server-workbench/useServerWorkbench.js";
import { DesktopTopOverlay } from "../../src/DesktopTopOverlay.js";
import { BrowserConsoleView } from "../../src/browser-console/BrowserConsoleView.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import {
  serverProfileSchema,
  type ServerWorkbenchSnapshot,
  type ServerWorkbenchRequest,
  type IPlatformService,
} from "@zcode/shared";
import type { IServerWorkbenchService } from "@zcode/services";

const changed = new Set<(s: ServerWorkbenchSnapshot) => void>();
const state: ServerWorkbenchSnapshot = {
  servers: [],
  metrics: [],
  terminals: [],
  connections: [],
  proposals: [],
  transfers: [],
  messages: [],
  desktopAvailable: true,
};
const requests: ServerWorkbenchRequest[] = [];
const publish = () => changed.forEach((fn) => fn(structuredClone(state)));
const service: IServerWorkbenchService = {
  onDidChange: (listener) => {
    changed.add(listener);
    return { dispose: () => changed.delete(listener) };
  },
  onTerminalData: () => ({ dispose() {} }),
  snapshot: async () => structuredClone(state),
  async perform(r) {
    requests.push(r);
    if (r.op === "save") {
      const profile = serverProfileSchema.parse(r.profile);
      const saved = {
        ...profile,
        id: profile.id ?? "fixture",
        hasPassword: !!r.credentials?.password,
        hasRdpPassword: !!r.credentials?.rdpPassword,
      };
      const index = state.servers.findIndex((s) => s.id === saved.id);
      if (index < 0) state.servers.push(saved);
      else state.servers[index] = saved;
      publish();
      return { id: saved.id };
    }
    if (r.op === "connect")
      state.connections = [{ serverId: r.serverId, generation: 1, state: "online" }];
    if (r.op === "terminalCreate") {
      const id = "terminal-" + state.terminals.length;
      state.terminals.push({
        id,
        serverId: r.serverId,
        generation: 1,
        name: id,
        output: "fixture shell\r\n",
        exited: false,
        sequence: 15,
      });
      publish();
      return { id };
    }
    if (r.op === "terminalClose") state.terminals = state.terminals.filter((t) => t.id !== r.id);
    if (r.op === "terminalRename") {
      const t = state.terminals.find((t) => t.id === r.id);
      if (t) t.name = r.name;
    }
    if (r.op === "assistant")
      state.proposals.push({
        id: "ai-proposal",
        serverId: r.serverId,
        generation: 1,
        command: "Get-Service",
        cwd: "",
        reason: "检查服务状态",
        state: "pending",
        createdAt: Date.now(),
      });
    if (r.op === "decide") {
      const p = state.proposals.find((p) => p.id === r.id);
      if (p?.state === "pending") {
        p.state = r.allow ? "completed" : "rejected";
        p.output = r.allow ? "service output" : "";
        p.exitCode = r.allow ? 0 : undefined;
      }
    }
    if (r.op === "files")
      return {
        files: [],
        path: r.path || (r.serverId ? "/remote" : "C:/fixture"),
        truncated: false,
      };
    if (r.op === "desktop") return { ok: true, available: true };
    publish();
    return {};
  },
};
const platform = {
  selectDirectory: async () => null,
  getPathForFile: () => undefined,
  browserConsoleListInstances: async () => [
    {
      id: "default",
      name: "Default",
      partition: "persist:fixture",
      proxy: { mode: "direct" },
      createdAt: 0,
      color: "blue",
    },
  ],
  browserConsoleGetAgentBinding: async () => ({ instanceId: null }),
} as unknown as IPlatformService;
function Harness() {
  const c = useServerWorkbench(service, true),
    [view, setView] = useState("chat"),
    [sidebarVisible, setSidebarVisible] = useState(true);
  return (
    <div data-workspace-shell="true" className="relative flex h-full">
      <nav className="shrink-0 overflow-hidden pt-14" style={{ width: sidebarVisible ? 260 : 0 }}>
        <button onClick={() => setView("chat")}>返回对话</button>
        <button onClick={() => setView("browser")}>打开测试浏览器</button>
        <ServerSidebarEntry
          controller={c}
          active={view === "servers"}
          onOpen={() => setView("servers")}
        />
      </nav>
      <section data-workspace-conversation-frame="true" className="min-w-0 flex-1">
        <output data-testid="view" className="sr-only">
          {view}
        </output>
        <textarea aria-label="对话草稿" hidden={view !== "chat"} />
        <div style={{ height: "100%", display: view === "servers" ? "block" : "none" }}>
          <ServerWorkbenchView controller={c} visible={view === "servers"} showWindowControls />
        </div>
        <div style={{ height: "100%", display: view === "browser" ? "block" : "none" }}>
          <BrowserConsoleView
            workspaceKey="fixture"
            sessionId={null}
            isVisible={view === "browser"}
            showWindowControls
          />
        </div>
      </section>
      <DesktopTopOverlay
        workspaceAbsPath="fixture"
        isDesktop
        isWindowsDesktop
        isSidebarVisible={sidebarVisible}
        updateReadyVersion={null}
        updateState={null}
        toggleSidebarShortcutLabel="Ctrl+B"
        newTaskShortcutLabel="Ctrl+N"
        goBackShortcutLabel=""
        goForwardShortcutLabel=""
        canTaskNavBack={false}
        canTaskNavForward={false}
        canGoBack={false}
        canGoForward={false}
        appLogoUrl=""
        platform={platform}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onCreateTask={() => {}}
        onGoBack={() => {}}
        onGoForward={() => {}}
      />
    </div>
  );
}
Object.assign(window, {
  serverWorkbenchTest: {
    requests,
    background() {
      state.messages.push({
        id: "background",
        serverId: "fixture",
        role: "assistant",
        text: "后台诊断完成",
      });
      publish();
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale="zh-CN">
    <PlatformProvider platform={platform}>
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    </PlatformProvider>
  </ZCodeIntlProvider>,
);

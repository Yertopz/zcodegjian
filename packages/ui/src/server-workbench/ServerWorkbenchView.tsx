import { useState } from "react";
import { DesktopWindowControls } from "@/DesktopWindowControls.js";
import { Plus, Server, TerminalSquare, Monitor, Settings2, Trash2 } from "lucide-react";
import type { ServerProfile } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable.js";
import { ServerProfileDialog } from "./ServerProfileDialog.js";
import { ServerConnectDialog } from "./ServerConnectDialog.js";
import { ServerTerminalPane } from "./ServerTerminalPane.js";
import { ServerDesktopPane } from "./ServerDesktopPane.js";
import { ServerAssistantPane } from "./ServerAssistantPane.js";
import { ServerFilePanel } from "./ServerFilePanel.js";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import { useServerText } from "./text.js";

export function ServerWorkbenchView({
  controller: c,
  visible,
  showWindowControls = false,
}: {
  controller: ServerWorkbenchController;
  visible: boolean;
  showWindowControls?: boolean;
}) {
  const t = useServerText(),
    [filter, setFilter] = useState(""),
    [editing, setEditing] = useState<ServerProfile | null | undefined>(),
    [connecting, setConnecting] = useState<{ server: ServerProfile; desktop: boolean }>(),
    [pane, setPane] = useState<"terminal" | "desktop">("terminal"),
    [fileOpen, setFileOpen] = useState(true),
    [renaming, setRenaming] = useState<string>(),
    [name, setName] = useState("");
  const server = c.snapshot.servers.find((s) => s.id === c.selectedId),
    terminals = c.snapshot.terminals.filter((s) => s.serverId === server?.id),
    terminal =
      terminals.find((s) => s.id === c.terminalId) ||
      terminals.find((s) => !s.exited) ||
      terminals[0];
  const openTerminal = (p: ServerProfile) => {
    void c
      .request({ op: "terminalCreate", serverId: p.id })
      .then((r) => {
        c.select(p.id, r.id);
        setPane("terminal");
      })
      .catch(() => {});
  };
  return (
    <main className="flex h-full min-h-0 flex-col bg-background" data-testid="server-workbench">
      <header
        data-testid="server-workbench-toolbar"
        style={{ paddingLeft: "max(1rem, var(--workspace-view-toolbar-inset, 0px))" }}
        className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2 [app-region:drag] [&_button]:[app-region:no-drag] [&_input]:[app-region:no-drag]"
      >
        <Button variant="ghost" size="sm" onClick={() => c.select(null)}>
          <Server className="size-4" />
          {t.entry}
        </Button>
        {server ? (
          <>
            <span className="text-ui-base font-medium">/ {server.name}</span>
            <span className="text-ui-caption text-muted-foreground">{server.host}</span>
          </>
        ) : null}
        <div className="flex-1" />
        {server ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConnecting({ server, desktop: false })}
            >
              {t.connect}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFileOpen((v) => !v)}>
              {fileOpen ? t.collapseFiles : t.expandFiles}
            </Button>
          </>
        ) : (
          <Input
            className="max-w-72"
            aria-label={t.search}
            placeholder={t.search}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        <Button size="sm" onClick={() => setEditing(null)}>
          <Plus className="size-4" />
          {t.add}
        </Button>
        {showWindowControls ? <DesktopWindowControls /> : null}
      </header>
      {c.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 bg-destructive/10 px-4 py-2 text-ui-caption text-destructive"
        >
          <span className="break-all">{c.error}</span>
          <button onClick={() => c.setError(null)}>×</button>
        </div>
      ) : null}
      {!server ? (
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {c.snapshot.servers
              .filter((s) =>
                `${s.name} ${s.host} ${s.group}`.toLowerCase().includes(filter.toLowerCase()),
              )
              .map((p) => {
                const state =
                  c.snapshot.connections.find((x) => x.serverId === p.id)?.state || "offline";
                const metric = c.snapshot.metrics.find((x) => x.serverId === p.id);
                return (
                  <article
                    key={p.id}
                    className="rounded-xl border border-border bg-surface p-4"
                    data-testid="server-card"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-3 size-2 shrink-0 rounded-full ${state === "online" ? "bg-emerald-500" : state === "connecting" ? "bg-amber-500" : "bg-muted-foreground"}`}
                      />
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-foreground">
                        {p.os === "windows" ? (
                          <Monitor className="size-6" />
                        ) : (
                          <TerminalSquare className="size-6" />
                        )}
                      </div>
                      <button className="min-w-0 flex-1 text-left" onClick={() => c.select(p.id)}>
                        <div className="truncate text-ui-base font-medium">{p.name}</div>
                        <div className="mt-1 truncate text-ui-caption text-muted-foreground">
                          {p.username}@{p.host}:{p.port}
                        </div>
                        <div className="mt-1 text-ui-caption text-muted-foreground">
                          {p.os} {p.group ? ` · ${p.group}` : ""} · {t[state]}
                        </div>
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t.edit}
                        onClick={() => setEditing(p)}
                      >
                        <Settings2 className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t.remove}
                        onClick={() => {
                          if (window.confirm(t.confirmDelete))
                            c.run({ op: "delete", serverId: p.id });
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3 text-ui-caption text-muted-foreground">
                      <span>CPU: {metric ? `${metric.cpu.toFixed(1)}%` : "--"}</span>
                      <span>RAM: {metric ? `${metric.memory.toFixed(1)}%` : "--"}</span>
                      <span>Disk: {metric ? `${metric.disk.toFixed(1)}%` : "--"}</span>
                    </div>
                    <p className="mt-1 text-ui-caption text-muted-foreground">
                      {metric
                        ? `${new Date(metric.sampledAt).toLocaleString()} · ${t.sampleSnapshot}`
                        : t.metrics}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConnecting({ server: p, desktop: false })}
                      >
                        {t.connect}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={state !== "online"}
                        onClick={() => openTerminal(p)}
                      >
                        {t.newTerminal}
                      </Button>
                      {p.os === "windows" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!c.snapshot.desktopAvailable}
                          onClick={() => {
                            c.select(p.id);
                            setPane("desktop");
                            setConnecting({ server: p, desktop: true });
                          }}
                        >
                          {t.desktop}
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="sm" onClick={() => c.select(p.id)}>
                        {t.files}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={state !== "online"}
                        onClick={() => {
                          c.select(p.id);
                          c.run({ op: "metrics", serverId: p.id });
                        }}
                      >
                        {t.collectMetrics}
                      </Button>
                      {state === "online" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (window.confirm(t.confirmDisconnect))
                              c.run({ op: "disconnect", serverId: p.id });
                          }}
                        >
                          {t.disconnect}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
          </div>
          {!c.snapshot.servers.length ? (
            <div className="mx-auto mt-16 max-w-sm text-center text-ui-base text-muted-foreground">
              <Server className="mx-auto mb-4 size-10" />
              {t.noServer}
            </div>
          ) : null}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="vertical"
          layoutId="server-workbench-vertical"
          panelIds={fileOpen ? ["work", "files"] : ["work"]}
        >
          <ResizablePanel id="work" defaultSize="70%" minSize="30%">
            <ResizablePanelGroup orientation="horizontal" layoutId="server-workbench-horizontal">
              <ResizablePanel id="terminal" defaultSize="62%" minSize="30%">
                <section className="flex h-full min-h-0 flex-col">
                  <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle p-2">
                    <Button
                      size="sm"
                      variant={pane === "terminal" ? "secondary" : "ghost"}
                      onClick={() => setPane("terminal")}
                    >
                      {t.terminal}
                    </Button>
                    {server.os === "windows" ? (
                      <Button
                        size="sm"
                        variant={pane === "desktop" ? "secondary" : "ghost"}
                        disabled={!c.snapshot.desktopAvailable}
                        onClick={() => setPane("desktop")}
                      >
                        {t.desktop}
                      </Button>
                    ) : null}
                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => openTerminal(server)}>
                      <Plus className="size-3" />
                      {t.newTerminal}
                    </Button>
                  </div>
                  <div className={pane === "terminal" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                    <div className="flex overflow-auto border-b border-border-subtle">
                      {terminals.map((item) => (
                        <div
                          key={item.id}
                          className={`flex shrink-0 items-center ${terminal?.id === item.id ? "bg-selected" : ""}`}
                        >
                          <button
                            className="px-3 py-2 text-ui-caption"
                            onClick={() => c.select(server.id, item.id)}
                            onDoubleClick={() => {
                              setRenaming(item.id);
                              setName(item.name);
                            }}
                          >
                            {item.name}
                            {item.exited ? ` · ${t.exit}` : ""}
                          </button>
                          <button
                            className="px-2 text-muted-foreground"
                            aria-label={t.close}
                            onClick={() => c.run({ op: "terminalClose", id: item.id })}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    {renaming ? (
                      <form
                        className="flex gap-2 p-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          c.run({ op: "terminalRename", id: renaming, name });
                          setRenaming(undefined);
                        }}
                      >
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                        <Button type="submit" size="sm">
                          {t.rename}
                        </Button>
                      </form>
                    ) : null}
                    <div className="min-h-0 flex-1">
                      {terminal ? (
                        <ServerTerminalPane
                          key={terminal.id}
                          terminal={terminal}
                          controller={c}
                          visible={visible && pane === "terminal"}
                        />
                      ) : (
                        <p className="p-5 text-ui-caption text-muted-foreground">{t.noTerminal}</p>
                      )}
                    </div>
                    <div
                      className="max-h-32 overflow-auto border-t border-border-subtle text-ui-caption"
                      data-testid="server-command-log"
                    >
                      {c.snapshot.proposals
                        .filter(
                          (p) => p.serverId === server.id && p.state !== "pending" && !p.action,
                        )
                        .slice(-10)
                        .map((p) => (
                          <details key={p.id} className="px-3 py-1">
                            <summary>
                              {p.command.slice(0, 100)} · {t[p.state]}
                              {p.exitCode === undefined ? "" : ` (${p.exitCode})`}
                            </summary>
                            <pre className="whitespace-pre-wrap break-all">{p.output}</pre>
                          </details>
                        ))}
                    </div>
                  </div>
                  {server.os === "windows" ? (
                    <div className={pane === "desktop" ? "min-h-0 flex-1" : "hidden"}>
                      <ServerDesktopPane
                        key={server.id}
                        server={server}
                        controller={c}
                        visible={visible && pane === "desktop"}
                        onConnect={() => setConnecting({ server, desktop: true })}
                      />
                    </div>
                  ) : null}
                </section>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel id="assistant" defaultSize="38%" minSize="25%">
                <ServerAssistantPane key={server.id} server={server} controller={c} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          {fileOpen ? (
            <>
              <ResizableHandle />
              <ResizablePanel id="files" defaultSize="30%" minSize="15%">
                <ServerFilePanel key={server.id} server={server} controller={c} />
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      )}
      {editing !== undefined ? (
        <ServerProfileDialog
          profile={editing || undefined}
          controller={c}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      {connecting ? (
        <ServerConnectDialog
          key={`${connecting.server.id}:${connecting.desktop}`}
          server={connecting.server}
          desktop={connecting.desktop}
          controller={c}
          onClose={() => {
            c.select(connecting.server.id);
            if (connecting.desktop) setPane("desktop");
            setConnecting(undefined);
          }}
        />
      ) : null}
    </main>
  );
}

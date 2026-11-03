import { FileList, formatSize, childPath } from "./ServerFileList.js";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ServerFile, ServerProfile } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import { useServerText } from "./text.js";
export function ServerFilePanel({
  server,
  controller: c,
}: {
  server: ServerProfile;
  controller: ServerWorkbenchController;
}) {
  const t = useServerText(),
    platform = usePlatform(),
    [local, setLocal] = useState(""),
    [remote, setRemote] = useState(""),
    [localSelected, setLocalSelected] = useState<ServerFile[]>([]),
    [remoteSelected, setRemoteSelected] = useState<ServerFile[]>([]),
    [hidden, setHidden] = useState(false),
    [overwrite, setOverwrite] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [saveAs, setSaveAs] = useState<{
    source: string;
    destination: string;
    direction: "upload" | "download";
  }>();
  useEffect(() => {
    setRemote("");
    setRemoteSelected([]);
  }, [server.id]);
  const online = c.snapshot.connections.some(
    (s) => s.serverId === server.id && s.state === "online",
  );
  const tasks = c.snapshot.transfers.filter((s) => s.serverId === server.id);
  const start = useCallback(
    (direction: "upload" | "download", files: ServerFile[]) => {
      for (const file of files)
        c.run({
          op: "transfer",
          serverId: server.id,
          direction,
          source: file.path,
          destination: childPath(direction === "upload" ? remote : local, file.name),
          overwrite,
        });
    },
    [c.run, server.id, remote, local, overwrite],
  );
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="server-files"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!online || !remote) return;
        const files = [...e.dataTransfer.files].flatMap((file) => {
          const path = platform.getPathForFile?.(file);
          return path
            ? [
                {
                  name: file.name,
                  path,
                  directory: false,
                  size: file.size,
                  modified: file.lastModified,
                },
              ]
            : [];
        });
        start("upload", files);
      }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-1 text-ui-caption">
        <strong>{t.files}</strong>
        <Button
          size="sm"
          variant="ghost"
          disabled={!online || !remote || !localSelected.length}
          onClick={() => start("upload", localSelected)}
        >
          <ArrowUp className="size-3" />
          {t.upload}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!online || !local || !remoteSelected.length}
          onClick={() => start("download", remoteSelected)}
        >
          <ArrowDown className="size-3" />
          {t.download}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void platform.selectDirectory().then((p) => {
              if (p) setLocal(p);
            });
          }}
        >
          {t.chooseFolder}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRefresh((v) => v + 1)}>
          {t.refresh}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!online || (localSelected.length !== 1 && remoteSelected.length !== 1)}
          onClick={() => {
            const upload = localSelected.length === 1;
            const file = (upload ? localSelected : remoteSelected)[0];
            if (!file) return;
            setSaveAs({
              source: file.path,
              destination: childPath(upload ? remote : local, file.name),
              direction: upload ? "upload" : "download",
            });
          }}
        >
          {t.saveAs}
        </Button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          {t.hidden}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          {t.overwrite}
        </label>
      </header>
      <div className="flex min-h-0 flex-1 divide-x divide-border-subtle">
        <FileList
          label={t.local}
          controller={c}
          path={local}
          setPath={setLocal}
          selected={localSelected}
          onSelect={setLocalSelected}
          hidden={hidden}
          refreshToken={refresh}
        />
        {online ? (
          <FileList
            key={server.id}
            label={t.remote}
            serverId={server.id}
            controller={c}
            path={remote}
            setPath={setRemote}
            selected={remoteSelected}
            onSelect={setRemoteSelected}
            hidden={hidden}
            refreshToken={refresh}
          />
        ) : (
          <p className="flex-1 p-4 text-ui-caption text-muted-foreground">{t.connect}</p>
        )}
      </div>
      {tasks.length ? (
        <div className="max-h-24 shrink-0 overflow-auto border-t border-border-subtle px-3 text-ui-caption">
          {tasks.slice(-20).map((task) => (
            <div key={task.id} className="flex items-center gap-2 py-1">
              <span
                className="min-w-0 flex-1 truncate"
                title={`${task.source} → ${task.destination}`}
              >
                {task.source} → {task.destination}
              </span>
              <span>
                {formatSize(task.bytes)} / {formatSize(task.total)}
              </span>
              <span>{t[task.state as keyof typeof t] || task.state}</span>
              {task.state === "running" || task.state === "queued" ? (
                <button onClick={() => c.run({ op: "transferCancel", id: task.id })}>
                  {t.cancel}
                </button>
              ) : task.state === "failed" || task.state === "cancelled" ? (
                <button
                  onClick={() =>
                    c.run({
                      op: "transfer",
                      serverId: task.serverId,
                      source: task.source,
                      destination: task.destination,
                      direction: task.direction,
                      overwrite,
                      resumeId: task.resumeAvailable ? task.id : undefined,
                    })
                  }
                >
                  {task.resumeAvailable ? t.resume : t.retry}
                </button>
              ) : null}
              {task.state === "running" && task.bytes > 0 ? (
                <span className="whitespace-nowrap text-muted-foreground">
                  {formatSize(task.bytes / Math.max(1, (Date.now() - task.startedAt) / 1000))}/s ·{" "}
                  {Math.ceil(
                    Math.max(0, task.total - task.bytes) /
                      Math.max(1, task.bytes / Math.max(1, (Date.now() - task.startedAt) / 1000)),
                  )}
                  s
                </span>
              ) : null}
              {task.sha256 ? (
                <span className="text-emerald-500" title={`SHA-256: ${task.sha256}`}>
                  SHA-256 ✓
                </span>
              ) : null}
              {task.error ? (
                <span className="max-w-60 truncate text-destructive" title={task.error}>
                  {task.error}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <Dialog
        open={Boolean(saveAs)}
        onOpenChange={(open) => {
          if (!open) setSaveAs(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.saveAs}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (saveAs) {
                c.run({ op: "transfer", serverId: server.id, ...saveAs, overwrite: false });
                setSaveAs(undefined);
              }
            }}
          >
            <Input
              aria-label={t.path}
              value={saveAs?.destination ?? ""}
              onChange={(e) =>
                setSaveAs((old) => (old ? { ...old, destination: e.target.value } : old))
              }
            />
            <Button type="submit" disabled={!saveAs?.destination}>
              {t.transfer}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

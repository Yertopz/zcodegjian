import { useState } from "react";
import { ChevronDown, ChevronRight, Server, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu.js";
import { cn } from "@/components/lib/utils.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import { useServerText } from "./text.js";

export function ServerSidebarEntry({
  controller: c,
  active,
  onOpen,
}: {
  controller: ServerWorkbenchController;
  active: boolean;
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [renaming, setRenaming] = useState<string>(),
    [name, setName] = useState(""),
    t = useServerText();
  const running = c.snapshot.terminals.filter((terminal) => !terminal.exited);
  return (
    <div data-testid="ssh-sidebar-entry">
      <div className={cn("flex rounded-md", active && "bg-selected")}>
        <Button
          variant="ghost"
          size="lg"
          className="min-w-0 flex-1 justify-start gap-2"
          onClick={() => {
            c.select(null);
            onOpen();
          }}
        >
          <Server className="size-4" />
          {t.entry}
        </Button>
        <button
          className="px-2 text-muted-foreground hover:text-foreground"
          aria-label={t.entry}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
      </div>
      {expanded ? (
        <div className="max-h-48 overflow-auto pl-4 text-ui-caption">
          {!running.length ? (
            <p className="py-2 text-muted-foreground">{t.empty}</p>
          ) : (
            c.snapshot.servers.map((server) => {
              const items = running.filter((item) => item.serverId === server.id);
              return items.length ? (
                <div key={server.id}>
                  <div className="truncate py-1 text-muted-foreground">{server.name}</div>
                  {items.map((terminal) => (
                    <ContextMenu key={terminal.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          className="flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left hover:bg-surface-hover"
                          onClick={() => {
                            c.select(server.id, terminal.id);
                            onOpen();
                          }}
                        >
                          <TerminalSquare className="size-3 shrink-0" />
                          {terminal.name}
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onSelect={() => {
                            setRenaming(terminal.id);
                            setName(terminal.name);
                          }}
                        >
                          {t.rename}
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => {
                            c.select(server.id, terminal.id);
                            onOpen();
                          }}
                        >
                          {t.terminal}
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => {
                            void navigator.clipboard.writeText(
                              `ssh -p ${server.port} ${server.username}@${server.host}`,
                            );
                          }}
                        >
                          {t.copy}
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => c.run({ op: "terminalClose", id: terminal.id })}
                        >
                          {t.close}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              ) : null;
            })
          )}
        </div>
      ) : null}
      <Dialog
        open={Boolean(renaming)}
        onOpenChange={(open) => {
          if (!open) setRenaming(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.rename}</DialogTitle>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming && name.trim()) {
                c.run({ op: "terminalRename", id: renaming, name });
                setRenaming(undefined);
              }
            }}
          >
            <Input
              aria-label={t.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
            <Button type="submit" disabled={!name.trim()}>
              {t.save}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

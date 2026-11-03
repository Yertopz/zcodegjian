import { useEffect, useRef, useState } from "react";
import type { ServerProfile } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import { useServerText } from "./text.js";

export function ServerAssistantPane({
  server,
  controller: c,
}: {
  server: ServerProfile;
  controller: ServerWorkbenchController;
}) {
  const t = useServerText(),
    [draft, setDraft] = useState(""),
    [includeOutput, setIncludeOutput] = useState(false),
    [includeDesktop, setIncludeDesktop] = useState(false),
    [busy, setBusy] = useState(false),
    [command, setCommand] = useState(""),
    [cwd, setCwd] = useState(""),
    [manual, setManual] = useState(false),
    bottom = useRef<HTMLDivElement>(null);
  const messages = c.snapshot.messages.filter((m) => m.serverId === server.id),
    proposals = c.snapshot.proposals.filter((p) => p.serverId === server.id);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, proposals.length]);
  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-border-subtle"
      data-testid="server-assistant"
    >
      <header className="border-b border-border-subtle p-3">
        <div className="text-ui-base font-medium">{t.ai}</div>
        <p className="mt-1 text-ui-caption text-muted-foreground">{t.controls}</p>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-ui-base">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-5 whitespace-pre-wrap rounded-lg bg-surface p-3"
                : "whitespace-pre-wrap p-1"
            }
          >
            {m.text}
          </div>
        ))}
        {proposals.map((p) => (
          <section
            key={p.id}
            className="space-y-2 rounded-lg border border-border bg-surface p-3 text-ui-caption"
            data-testid="server-approval"
          >
            <div className="flex justify-between gap-2">
              <strong>{t.approval}</strong>
              <span>{t[p.state as keyof typeof t] || p.state}</span>
            </div>
            <div className="break-all text-muted-foreground">
              {server.username}@{server.host} · {server.shell}
              {p.cwd ? ` · ${p.cwd}` : ""}
            </div>
            <p>{p.reason}</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono">
              {p.action ? JSON.stringify(p.action, null, 2) : p.command}
            </pre>
            {p.state === "pending" ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => c.run({ op: "decide", id: p.id, allow: true })}>
                  {t.approve}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => c.run({ op: "decide", id: p.id, allow: false })}
                >
                  {t.reject}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCommand(p.command);
                    setCwd(p.cwd);
                    setManual(true);
                    c.run({ op: "decide", id: p.id, allow: false });
                  }}
                >
                  {t.edit}
                </Button>
              </div>
            ) : null}
            {p.output ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono">
                {p.output}
                {p.exitCode !== undefined ? `\nexit: ${p.exitCode}` : ""}
              </pre>
            ) : null}
          </section>
        ))}
        <div ref={bottom} />
      </div>
      <div className="space-y-2 border-t border-border-subtle p-3">
        <div className="flex items-center justify-between text-ui-caption">
          <button onClick={() => setManual((v) => !v)}>{t.manual}</button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              c.run({ op: "cancel", serverId: server.id });
              setBusy(false);
            }}
          >
            {t.stop}
          </Button>
        </div>
        {manual ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void c
                .request({ op: "propose", serverId: server.id, command, cwd, reason: t.manual })
                .then(() => {
                  setCommand("");
                  setManual(false);
                })
                .catch(() => {});
            }}
          >
            <Input
              aria-label={t.cwd}
              placeholder={t.cwd}
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
            />
            <Textarea
              aria-label={t.command}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t.command}
            />
            <Button size="sm" type="submit" disabled={!command.trim()}>
              {t.propose}
            </Button>
          </form>
        ) : null}
        <label className="flex items-center gap-2 text-ui-caption text-muted-foreground">
          <input
            type="checkbox"
            checked={includeOutput}
            onChange={(e) => setIncludeOutput(e.target.checked)}
          />
          {t.allowOutput}
        </label>
        {server.os === "windows" ? (
          <label className="flex items-center gap-2 text-ui-caption text-muted-foreground">
            <input
              type="checkbox"
              checked={includeDesktop}
              onChange={(e) => setIncludeDesktop(e.target.checked)}
            />
            {t.allowDesktop}
          </label>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim() || busy) return;
            const text = draft;
            setDraft("");
            setBusy(true);
            void c
              .request({
                op: "assistant",
                serverId: server.id,
                text,
                includeOutput,
                includeDesktop,
              })
              .catch(() => setDraft(text))
              .finally(() => setBusy(false));
          }}
        >
          <Textarea
            placeholder={t.ask}
            aria-label={t.ask}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" type="submit" disabled={busy || !draft.trim()}>
              {busy ? "…" : t.send}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}

import { useState } from "react";
import type { ServerProfile } from "@zcode/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import { useServerText } from "./text.js";

export function ServerProfileDialog({
  profile,
  onClose,
  controller: c,
}: {
  profile?: ServerProfile;
  onClose: () => void;
  controller: ServerWorkbenchController;
}) {
  const t = useServerText(),
    platform = usePlatform();
  const [draft, setDraft] = useState({
    name: "",
    host: "",
    port: 22,
    username: "",
    os: "linux" as "windows" | "linux",
    shell: "sh" as "powershell" | "cmd" | "sh",
    group: "",
    rdpPort: 3389,
    rdpUsername: "",
    rdpHost: "",
    privateKeyPath: "",
    ...profile,
  });
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string>();
  const [rdpPassword, setRdpPassword] = useState<string>();
  // 未触碰的空框不覆盖 Host 保存值；显式清除才发送 null。
  const passwordField = (desktop = false) => {
    const value = desktop ? rdpPassword : password;
    const setValue = desktop ? setRdpPassword : setPassword;
    const saved = desktop ? profile?.hasRdpPassword : profile?.hasPassword;
    return (
      <div className="grid gap-1">
        <label className="grid gap-1 text-ui-caption">
          {desktop ? t.rdpPassword : t.password}
          <Input
            type="password"
            autoComplete="new-password"
            value={value ?? ""}
            placeholder={saved && value === undefined ? t.savedPassword : t.passwordOptional}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {saved ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setValue("")}
            disabled={value === ""}
          >
            {t.clearPassword}
          </Button>
        ) : null}
      </div>
    );
  };
  const field = (
    key: "name" | "host" | "username" | "group" | "rdpUsername" | "rdpHost" | "privateKeyPath",
    label: string,
  ) => (
    <label className="grid gap-1 text-ui-caption">
      {label}
      <Input
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        required={["name", "host", "username"].includes(key)}
      />
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile ? t.edit : t.add}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void c
              .request({
                op: "save",
                profile: draft,
                credentials: {
                  password: password === undefined ? undefined : password || null,
                  rdpPassword: rdpPassword === undefined ? undefined : rdpPassword || null,
                },
              })
              .then(onClose)
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
        >
          {field("name", t.name)}
          {field("host", t.host)}
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-ui-caption">
              {t.port}
              <Input
                type="number"
                min={1}
                max={65535}
                value={draft.port}
                onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })}
              />
            </label>
            {field("username", t.user)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-ui-caption">
              {t.system}
              <select
                aria-label={t.system}
                className="rounded-md border border-input bg-background p-2"
                value={draft.os}
                onChange={(e) => {
                  const os = e.target.value as "windows" | "linux";
                  setDraft({ ...draft, os, shell: os === "windows" ? "powershell" : "sh" });
                }}
              >
                <option value="linux">Linux</option>
                <option value="windows">Windows</option>
              </select>
            </label>
            <label className="grid gap-1 text-ui-caption">
              {t.shell}
              <select
                aria-label={t.shell}
                className="rounded-md border border-input bg-background p-2"
                value={draft.shell}
                onChange={(e) =>
                  setDraft({ ...draft, shell: e.target.value as typeof draft.shell })
                }
              >
                {draft.os === "windows" ? (
                  <>
                    <option value="powershell">PowerShell</option>
                    <option value="cmd">CMD</option>
                  </>
                ) : (
                  <option value="sh">sh</option>
                )}
              </select>
            </label>
          </div>
          {field("group", t.group)}
          {passwordField()}
          <div className="flex items-end gap-2">
            <div className="flex-1">{field("privateKeyPath", t.key)}</div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void platform.selectFile().then((path) => {
                  if (path) setDraft({ ...draft, privateKeyPath: path });
                });
              }}
            >
              …
            </Button>
          </div>
          {draft.os === "windows" ? (
            <div className="grid grid-cols-2 gap-3">
              {field("rdpHost", t.rdpHost)}
              <label className="grid gap-1 text-ui-caption">
                {t.rdpPort}
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.rdpPort}
                  onChange={(e) => setDraft({ ...draft, rdpPort: Number(e.target.value) })}
                />
              </label>
              {field("rdpUsername", t.rdpUser)}
              {passwordField(true)}
            </div>
          ) : null}
          {c.error ? (
            <p role="alert" className="text-ui-caption text-destructive">
              {c.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button disabled={busy} type="submit">
              {t.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

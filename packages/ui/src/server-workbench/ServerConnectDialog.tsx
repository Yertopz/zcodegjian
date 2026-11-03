import { useState } from "react";
import type { ServerProfile } from "@zcode/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import { useServerText } from "./text.js";
export function ServerConnectDialog({
  server,
  desktop,
  controller: c,
  onClose,
}: {
  server: ServerProfile;
  desktop: boolean;
  controller: ServerWorkbenchController;
  onClose: () => void;
}) {
  const t = useServerText(),
    [password, setPassword] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [fingerprint, setFingerprint] = useState<string>(),
    [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      const result = desktop
        ? await c.request({
            op: "desktop",
            request: { op: "connect", serverId: server.id, generation: 0, password },
          })
        : await c.request({
            op: "connect",
            serverId: server.id,
            password,
            passphrase,
            fingerprint,
          });
      if (result.trustRequired) {
        setFingerprint(result.fingerprint);
        return;
      }
      setPassword("");
      setPassphrase("");
      onClose();
    } catch {
      /* 错误由 controller 显示；本框非空密码仅覆盖这次，保存值由 Host 读取。 */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {server.name} · {desktop ? t.desktop : t.connect}
          </DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <div className="text-ui-caption text-muted-foreground">
            {desktop ? server.rdpUsername || server.username : server.username}@{server.host}:
            {desktop ? server.rdpPort : server.port}
          </div>
          <label className="grid gap-1 text-ui-caption">
            {desktop ? t.rdpPassword : t.password}
            <Input
              type="password"
              autoComplete="off"
              value={password}
              placeholder={
                (desktop ? server.hasRdpPassword : server.hasPassword) ? t.savedPassword : undefined
              }
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {!desktop && server.privateKeyPath ? (
            <label className="grid gap-1 text-ui-caption">
              {t.passphrase}
              <Input
                type="password"
                autoComplete="off"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
          ) : null}
          {fingerprint ? (
            <div role="alert" className="rounded-md border border-warning/40 p-3 text-ui-caption">
              <p>{t.trust}</p>
              <code className="break-all">{fingerprint}</code>
            </div>
          ) : null}
          {c.error ? (
            <p role="alert" className="text-ui-caption text-destructive">
              {c.error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? t.connecting : fingerprint ? t.trustConnect : t.connect}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import {
  DEFAULT_BROWSER_INSTANCE_ID,
  MAX_BROWSER_INSTANCE_NAME_LENGTH,
  type BrowserInstanceColor,
  type BrowserInstanceRecord,
  type BrowserProxyConfig,
} from "@zcode/shared";
import { Globe, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const COLORS: BrowserInstanceColor[] = ["blue", "green", "orange", "purple", "pink", "gray"];

const COLOR_CLASS: Record<BrowserInstanceColor, string> = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  orange: "bg-orange-500",
  purple: "bg-violet-500",
  pink: "bg-pink-500",
  gray: "bg-gray-400",
};

const PROXY_MODES = ["inherit", "direct", "system", "fixed"] as const;
type ProxyMode = (typeof PROXY_MODES)[number];

function proxyModeOf(proxy: BrowserProxyConfig): ProxyMode {
  return proxy.mode;
}

export function InstanceStrip({
  instances,
  activeInstanceId,
  aiControlledInstanceId,
  busy,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onClearData,
}: {
  instances: BrowserInstanceRecord[];
  activeInstanceId: string | null;
  /** 当前会话已绑定「AI 控制」的实例；仅用于给用户一个可见徽标。 */
  aiControlledInstanceId?: string | null;
  busy: boolean;
  onSelect: (instanceId: string) => void;
  onCreate: (input: {
    name: string;
    color?: BrowserInstanceColor;
    proxy?: BrowserProxyConfig;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    patch: { name?: string; color?: BrowserInstanceColor; proxy?: BrowserProxyConfig },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClearData: (id: string, mode: "cache" | "all") => Promise<void>;
}): React.JSX.Element {
  const { intl } = useZCodeIntl();
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<BrowserInstanceColor>("blue");
  const [proxyMode, setProxyMode] = useState<ProxyMode>("inherit");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("8080");
  const [protocol, setProtocol] = useState<"http" | "https" | "socks5">("http");
  const [formError, setFormError] = useState<string | null>(null);

  const editing = instances.find((instance) => instance.id === editingId) ?? null;
  const isDefault = editing?.id === DEFAULT_BROWSER_INSTANCE_ID;

  const openCreate = () => {
    setDialogMode("create");
    setEditingId(null);
    setName(
      `${intl.formatMessage({ id: "browserConsole.instanceDefaultName" })} ${instances.length}`,
    );
    setColor("blue");
    setProxyMode("inherit");
    setHost("");
    setPort("8080");
    setProtocol("http");
    setFormError(null);
  };

  const openEdit = (instance: BrowserInstanceRecord) => {
    setDialogMode("edit");
    setEditingId(instance.id);
    setName(instance.name);
    setColor(instance.color ?? "blue");
    setProxyMode(proxyModeOf(instance.proxy));
    if (instance.proxy.mode === "fixed") {
      setHost(instance.proxy.host);
      setPort(String(instance.proxy.port));
      setProtocol(instance.proxy.protocol);
    } else {
      setHost("");
      setPort("8080");
      setProtocol("http");
    }
    setFormError(null);
  };

  const buildProxy = (): BrowserProxyConfig | null => {
    if (proxyMode === "inherit") return { mode: "inherit" };
    if (proxyMode === "direct") return { mode: "direct" };
    if (proxyMode === "system") return { mode: "system" };
    const parsedPort = Number(port);
    if (!host.trim() || !Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setFormError(intl.formatMessage({ id: "browserConsole.proxyInvalid" }));
      return null;
    }
    return { mode: "fixed", protocol, host: host.trim(), port: parsedPort };
  };

  const submit = async () => {
    if (!name.trim()) {
      setFormError(intl.formatMessage({ id: "browserConsole.instanceNameRequired" }));
      return;
    }
    const proxy = isDefault ? undefined : (buildProxy() ?? undefined);
    if (!isDefault && proxyMode === "fixed" && !proxy) return;
    if (dialogMode === "create") {
      await onCreate({
        name: name.trim(),
        color,
        ...(proxy ? { proxy } : {}),
      });
    } else if (editing) {
      await onUpdate(editing.id, {
        name: name.trim(),
        color,
        ...(proxy ? { proxy } : {}),
      });
    }
    setDialogMode(null);
  };

  return (
    <div className="flex min-h-0 items-center gap-1.5 overflow-x-auto border-b border-border-subtle bg-surface px-2 py-1.5">
      <Globe aria-hidden="true" className="ml-1 size-4 shrink-0 text-foreground-subtle" />
      {instances.map((instance) => {
        const active = instance.id === activeInstanceId;
        return (
          <div key={instance.id} className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={active}
              data-testid={`browser-console-instance-${instance.id}`}
              onClick={() => onSelect(instance.id)}
              className={cn("gap-1.5 rounded-full px-3", active && "bg-selected text-foreground")}
            >
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", COLOR_CLASS[instance.color ?? "gray"])}
              />
              <span className="max-w-32 truncate">{instance.name}</span>
              {instance.id === aiControlledInstanceId ? (
                <span
                  className="rounded bg-primary/15 px-1 text-ui-xs text-primary"
                  title={intl.formatMessage({ id: "browserConsole.aiControlledBadge" })}
                >
                  AI
                </span>
              ) : null}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={intl.formatMessage({ id: "browserConsole.instanceMenu" })}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => openEdit(instance)}>
                  {intl.formatMessage({ id: "browserConsole.instanceSettings" })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void onClearData(instance.id, "cache")}>
                  {intl.formatMessage({ id: "browserConsole.clearCache" })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void onClearData(instance.id, "all")}>
                  {intl.formatMessage({ id: "browserConsole.clearAll" })}
                </DropdownMenuItem>
                {instance.id === DEFAULT_BROWSER_INSTANCE_ID ? null : (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      if (activeInstanceId === instance.id) onSelect(instance.id);
                      void onDelete(instance.id);
                    }}
                  >
                    {intl.formatMessage({ id: "browserConsole.deleteInstance" })}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        data-testid="browser-console-create-instance"
        disabled={busy}
        onClick={openCreate}
        className="shrink-0 gap-1 rounded-full"
      >
        <Plus className="size-3.5" />
        {intl.formatMessage({ id: "browserConsole.newInstance" })}
      </Button>

      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({
                id:
                  dialogMode === "edit"
                    ? "browserConsole.instanceSettings"
                    : "browserConsole.newInstance",
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-ui-base text-foreground">
              {intl.formatMessage({ id: "browserConsole.instanceName" })}
              <Input
                value={name}
                maxLength={MAX_BROWSER_INSTANCE_NAME_LENGTH}
                onChange={(event) => setName(event.currentTarget.value)}
                data-testid="browser-console-instance-name"
              />
            </label>
            <div className="flex flex-col gap-1 text-ui-base text-foreground">
              {intl.formatMessage({ id: "browserConsole.color" })}
              <div className="flex gap-2">
                {COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={option}
                    aria-pressed={color === option}
                    onClick={() => setColor(option)}
                    className={cn(
                      "size-6 rounded-full ring-offset-2 ring-offset-background transition",
                      COLOR_CLASS[option],
                      color === option && "ring-2 ring-foreground",
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1 text-ui-base text-foreground">
              {intl.formatMessage({ id: "browserConsole.proxy" })}
              <Select
                value={proxyMode}
                disabled={isDefault}
                onValueChange={(value) => setProxyMode(value as ProxyMode)}
              >
                <SelectTrigger data-testid="browser-console-proxy-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">
                    {intl.formatMessage({ id: "browserConsole.proxyInherit" })}
                  </SelectItem>
                  <SelectItem value="direct">
                    {intl.formatMessage({ id: "browserConsole.proxyDirect" })}
                  </SelectItem>
                  <SelectItem value="system">
                    {intl.formatMessage({ id: "browserConsole.proxySystem" })}
                  </SelectItem>
                  <SelectItem value="fixed">
                    {intl.formatMessage({ id: "browserConsole.proxyFixed" })}
                  </SelectItem>
                </SelectContent>
              </Select>
              {isDefault ? (
                <p className="text-ui-xs text-foreground-subtle">
                  {intl.formatMessage({ id: "browserConsole.defaultProxyLocked" })}
                </p>
              ) : null}
              {proxyMode === "fixed" && !isDefault ? (
                <div className="mt-1 flex gap-2">
                  <Select
                    value={protocol}
                    onValueChange={(value) => setProtocol(value as typeof protocol)}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="https">HTTPS</SelectItem>
                      <SelectItem value="socks5">SOCKS5</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={host}
                    placeholder={intl.formatMessage({ id: "browserConsole.proxyHost" })}
                    onChange={(event) => setHost(event.currentTarget.value)}
                    className="flex-1"
                  />
                  <Input
                    value={port}
                    inputMode="numeric"
                    onChange={(event) => setPort(event.currentTarget.value)}
                    className="w-20"
                  />
                </div>
              ) : null}
              <p className="text-ui-xs text-foreground-subtle">
                {intl.formatMessage({ id: "browserConsole.reloadHint" })}
              </p>
            </div>
            {formError ? (
              <p role="alert" className="text-ui-base text-destructive">
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogMode(null)}>
              {intl.formatMessage({ id: "browserConsole.cancel" })}
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {intl.formatMessage({ id: "browserConsole.save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

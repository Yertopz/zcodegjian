import { useMemo, useState } from "react";
import type { BrowserNetworkEntry, BrowserNetworkResponseBodyResult } from "@zcode/shared";
import { Download, Eraser, Lock, LockOpen, Radio, Search } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const TYPE_FILTERS = ["all", "fetch", "js", "css", "img", "media", "ws", "other"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const RESOURCE_GROUP: Record<string, TypeFilter> = {
  xhr: "fetch",
  fetch: "fetch",
  script: "js",
  stylesheet: "css",
  image: "img",
  media: "media",
  websocket: "ws",
  WebSocket: "ws",
  document: "other",
};

function groupOf(entry: BrowserNetworkEntry): TypeFilter {
  return (
    RESOURCE_GROUP[entry.resourceType] ??
    RESOURCE_GROUP[entry.resourceType.toLowerCase()] ??
    "other"
  );
}

function formatSize(size: number | undefined): string {
  if (size === undefined || size < 0) return "–";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(entry: BrowserNetworkEntry): string {
  const end = entry.completedAt ?? entry.responseStartedAt;
  if (end === undefined) return "–";
  return `${Math.max(0, end - entry.startedAt)} ms`;
}

export function NetworkPanel({
  entries,
  dropped,
  showSensitive,
  deepCaptureEnabled,
  canDeepCapture,
  onToggleSensitive,
  onClear,
  onExportHar,
  onToggleDeepCapture,
  onLoadBody,
}: {
  entries: BrowserNetworkEntry[];
  dropped: number;
  showSensitive: boolean;
  deepCaptureEnabled: boolean;
  canDeepCapture: boolean;
  onToggleSensitive: () => void;
  onClear: () => void;
  onExportHar: () => void;
  onToggleDeepCapture: () => void;
  onLoadBody: (requestId: string) => Promise<BrowserNetworkResponseBodyResult>;
}): React.JSX.Element {
  const { intl } = useZCodeIntl();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [body, setBody] = useState<BrowserNetworkResponseBodyResult | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries
      .filter((entry) => entry.resourceType !== "console-marker")
      .filter((entry) => typeFilter === "all" || groupOf(entry) === typeFilter)
      .filter((entry) => !needle || entry.url.toLowerCase().includes(needle))
      .slice(-400);
  }, [entries, query, typeFilter]);

  const selected = visible.find((entry) => entry.id === selectedId) ?? null;

  const loadBody = async () => {
    if (!selected || !selected.id.startsWith("cdp:")) return;
    setBodyLoading(true);
    try {
      setBody(await onLoadBody(selected.id.slice(4)));
    } finally {
      setBodyLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-foreground-subtle" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={intl.formatMessage({ id: "browserConsole.filterUrl" })}
            className="h-7 pl-7 text-ui-base"
            data-testid="browser-console-network-filter"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.currentTarget.value as TypeFilter)}
          className="h-7 rounded-md border border-input-border bg-input px-1 text-ui-base text-foreground"
          aria-label={intl.formatMessage({ id: "browserConsole.filterType" })}
        >
          {TYPE_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {intl.formatMessage({ id: `browserConsole.type.${filter}` })}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon-sm"
          title={intl.formatMessage({
            id: showSensitive ? "browserConsole.hideSensitive" : "browserConsole.showSensitive",
          })}
          aria-pressed={showSensitive}
          onClick={onToggleSensitive}
        >
          {showSensitive ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={intl.formatMessage({ id: "browserConsole.exportHar" })}
          onClick={onExportHar}
        >
          <Download className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={intl.formatMessage({ id: "browserConsole.clearNetwork" })}
          onClick={onClear}
        >
          <Eraser className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canDeepCapture}
          aria-pressed={deepCaptureEnabled}
          onClick={onToggleDeepCapture}
          className={cn("gap-1", deepCaptureEnabled && "bg-selected")}
        >
          <Radio className="size-3.5" />
          {intl.formatMessage({
            id: deepCaptureEnabled ? "browserConsole.deepCaptureOn" : "browserConsole.deepCapture",
          })}
        </Button>
      </div>
      {dropped > 0 ? (
        <p className="px-2 py-1 text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "browserConsole.dropped" }, { count: dropped })}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          <p className="px-3 py-4 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "browserConsole.noRequests" })}
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-ui-xs">
            <thead className="sticky top-0 z-10 bg-surface text-foreground-subtle">
              <tr>
                <th className="w-16 px-1 py-1 text-left font-medium">
                  {intl.formatMessage({ id: "browserConsole.columnMethod" })}
                </th>
                <th className="px-1 py-1 text-left font-medium">
                  {intl.formatMessage({ id: "browserConsole.columnUrl" })}
                </th>
                <th className="w-10 px-1 py-1 text-left font-medium">
                  {intl.formatMessage({ id: "browserConsole.columnStatus" })}
                </th>
                <th className="w-12 px-1 py-1 text-left font-medium">
                  {intl.formatMessage({ id: "browserConsole.columnDuration" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => {
                    setSelectedId(entry.id === selectedId ? null : entry.id);
                    setBody(null);
                  }}
                  className={cn(
                    "cursor-pointer border-b border-border-subtle/50 hover:bg-surface-hover",
                    entry.id === selectedId && "bg-selected",
                  )}
                  data-testid="browser-console-network-row"
                >
                  <td className="truncate px-1 py-1 font-mono">{entry.method}</td>
                  <td className="truncate px-1 py-1" title={entry.url}>
                    {entry.url.replace(/^https?:\/\//, "")}
                  </td>
                  <td
                    className={cn(
                      "px-1 py-1 tabular-nums",
                      entry.error
                        ? "text-destructive"
                        : (entry.statusCode ?? 0) >= 400
                          ? "text-warning"
                          : "text-foreground",
                    )}
                  >
                    {entry.statusCode ?? (entry.error ? "ERR" : "…")}
                  </td>
                  <td className="px-1 py-1 tabular-nums">{formatDuration(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {selected ? (
        <div className="max-h-[45%] shrink-0 overflow-auto border-t border-border-subtle px-2 py-2 text-ui-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
            <dt className="text-foreground-subtle">URL</dt>
            <dd className="break-all">{selected.url}</dd>
            <dt className="text-foreground-subtle">
              {intl.formatMessage({ id: "browserConsole.columnType" })}
            </dt>
            <dd>{selected.resourceType}</dd>
            <dt className="text-foreground-subtle">
              {intl.formatMessage({ id: "browserConsole.columnSize" })}
            </dt>
            <dd>{formatSize(selected.size)}</dd>
            {selected.remoteAddress ? (
              <>
                <dt className="text-foreground-subtle">
                  {intl.formatMessage({ id: "browserConsole.remoteAddress" })}
                </dt>
                <dd>{selected.remoteAddress}</dd>
              </>
            ) : null}
            {selected.frameUrl ? (
              <>
                <dt className="text-foreground-subtle">Frame</dt>
                <dd className="break-all">{selected.frameUrl}</dd>
              </>
            ) : null}
            {selected.error ? (
              <>
                <dt className="text-foreground-subtle">Error</dt>
                <dd className="text-destructive">{selected.error}</dd>
              </>
            ) : null}
          </dl>
          {selected.requestHeaders ? (
            <HeaderBlock
              title={intl.formatMessage({ id: "browserConsole.requestHeaders" })}
              headers={selected.requestHeaders}
            />
          ) : null}
          {selected.responseHeaders ? (
            <HeaderBlock
              title={intl.formatMessage({ id: "browserConsole.responseHeaders" })}
              headers={Object.fromEntries(
                Object.entries(selected.responseHeaders).map(([key, value]) => [
                  key,
                  value.join(", "),
                ]),
              )}
            />
          ) : null}
          {selected.webSocketFrames && selected.webSocketFrames.length > 0 ? (
            <div className="mt-2">
              <h3 className="mb-1 font-medium text-foreground">
                {intl.formatMessage({ id: "browserConsole.webSocketFrames" })}
              </h3>
              <ul className="flex flex-col gap-0.5 font-mono">
                {selected.webSocketFrames.map((frame, index) => (
                  <li key={`${frame.at}-${index}`} className="break-all">
                    <span className="text-foreground-subtle">
                      {frame.direction === "sent" ? "↑" : "↓"}
                    </span>{" "}
                    {frame.payload}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {selected.source === "cdp" && selected.bodyAvailable ? (
            <div className="mt-2">
              <Button
                size="sm"
                variant="outline"
                disabled={bodyLoading}
                onClick={() => void loadBody()}
              >
                {intl.formatMessage({ id: "browserConsole.loadBody" })}
              </Button>
              {body ? (
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface p-2 font-mono whitespace-pre-wrap">
                  {body.ok ? body.body : body.reason}
                </pre>
              ) : null}
            </div>
          ) : selected.bodyUnavailableReason ? (
            <p className="mt-2 text-foreground-subtle">
              {intl.formatMessage({ id: "browserConsole.bodyUnavailable" })}：
              {selected.bodyUnavailableReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HeaderBlock({
  title,
  headers,
}: {
  title: string;
  headers: Record<string, string>;
}): React.JSX.Element {
  return (
    <div className="mt-2">
      <h3 className="mb-1 font-medium text-foreground">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono">
        {Object.entries(headers).map(([key, value]) => (
          <div key={key} className="col-span-2 grid grid-cols-[auto_1fr] gap-x-2">
            <dt className="text-foreground-subtle">{key}:</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

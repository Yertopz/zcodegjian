import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import { normalizeBrowserUrl } from "@/embeddedBrowserHelpers.js";

/** 地址栏：无协议且含空格时按搜索处理，其余交给既有 normalizeBrowserUrl。 */
export function resolveBrowserConsoleAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
  }
  return normalizeBrowserUrl(trimmed) ?? `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserConsoleEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Globe aria-hidden="true" className="size-8 text-foreground-subtle" />
      <h2 className="text-ui-lg font-medium text-foreground">{title}</h2>
      <p className="max-w-sm text-ui-base text-foreground-subtle">{body}</p>
      {action}
    </div>
  );
}

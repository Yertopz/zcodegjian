import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { BrowserConsoleTab } from "@/browser-console/useBrowserConsole.js";

export function ConsoleTabStrip({
  tabs,
  activeTabId,
  maxTabs,
  onActivate,
  onClose,
  onNew,
}: {
  tabs: BrowserConsoleTab[];
  activeTabId: string | null;
  maxTabs: number;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}): React.JSX.Element {
  const { intl } = useZCodeIntl();
  return (
    <div className="flex min-h-0 items-end gap-1 overflow-x-auto border-b border-border-subtle bg-surface px-2 pt-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const label =
          tab.title.trim() || tab.url || intl.formatMessage({ id: "browserConsole.untitledTab" });
        return (
          <div
            key={tab.id}
            className={cn(
              "group flex min-w-28 max-w-56 shrink-0 items-center gap-1 rounded-t-lg border border-b-0 px-2 py-1",
              active
                ? "border-border-subtle bg-background text-foreground"
                : "border-transparent text-foreground-subtle hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <button
              type="button"
              data-testid={`browser-console-tab-${tab.id}`}
              aria-pressed={active}
              onClick={() => onActivate(tab.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-ui-base"
            >
              {tab.isLoading ? (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 animate-pulse rounded-full bg-primary"
                />
              ) : null}
              <span className="truncate">{label}</span>
            </button>
            <button
              type="button"
              aria-label={intl.formatMessage({ id: "browserConsole.closeTab" })}
              onClick={() => onClose(tab.id)}
              className="rounded p-0.5 opacity-0 transition hover:bg-surface-hover group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={intl.formatMessage({ id: "browserConsole.newTab" })}
        disabled={tabs.length >= maxTabs}
        onClick={onNew}
        className="mb-0.5 shrink-0"
        data-testid="browser-console-new-tab"
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

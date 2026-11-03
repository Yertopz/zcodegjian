import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu.js";
import { useMainAgentPrompts } from "@/hooks/useMainAgentPrompts.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";

export function MainAgentPromptSelector({
  workspacePath,
  workspaceIdentity,
  selectedId,
  onSelect,
  disabled,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  selectedId: string | null | undefined;
  onSelect: (id: string | null) => Promise<void>;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const t = (key: string) => intl.formatMessage({ id: `settings.mainAgentPrompts.${key}` });
  const { library, error, refresh } = useMainAgentPrompts(workspacePath, workspaceIdentity);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const selected = library?.prompts.find(
    (item) => item.id === (selectedId === undefined ? library?.defaultId : selectedId),
  );
  async function select(id: string | null) {
    setPending(true);
    setFailure(null);
    try {
      await onSelect(id);
    } catch (cause) {
      setFailure(`${t("switchError")} ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="min-w-0">
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void refresh();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-testid="main-agent-prompt-selector"
            disabled={disabled || pending || !library}
            aria-label={t("title")}
            className="max-w-full gap-1 text-ui-caption"
          >
            <span className="truncate">{selected?.name ?? t("default")}</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto"
        >
          <DropdownMenuItem onSelect={() => void select(null)}>
            <span className="flex-1">{t("default")}</span>
            {!selected ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
          {library?.prompts.map((item) => (
            <DropdownMenuItem key={item.id} onSelect={() => void select(item.id)}>
              <div className="min-w-0 flex-1">
                <p className="break-words text-ui-base">{item.name}</p>
                <p className="whitespace-normal break-words text-ui-caption text-foreground-subtle">
                  {item.description}
                </p>
              </div>
              {selected?.id === item.id ? <Check className="size-4 shrink-0" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setPendingSettingsSectionIntent("mainAgentPrompts");
              openSettingsTab();
            }}
          >
            {t("manage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failure || error ? (
        <p role="alert" className="text-ui-caption text-destructive">
          {failure ?? t("loadError")}
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            {t("retry")}
          </Button>
        </p>
      ) : null}
    </div>
  );
}

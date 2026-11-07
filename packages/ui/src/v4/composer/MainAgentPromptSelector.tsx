import { useEffect, useState } from "react";
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
import {
  markComposerPromptScopePending,
  resolveComposerPromptScopeKey,
  syncComposerPromptScope,
} from "@/store/composerPromptModeStore.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";

export function MainAgentPromptSelector({
  workspacePath,
  workspaceIdentity,
  sessionId,
  selectedId,
  onSelect,
  disabled,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 会话 id；草稿态传 undefined，用来区分「同一工作区的不同输入框」。 */
  sessionId?: string | null;
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
  // 提示词模式的只读投影：本组件之外（@ 提及面板、群聊皮）只看得到 store，
  // 所以这里把「当前选中的提示词 id」写进按 scope 分键的快照。
  // 草稿仍是 mainAgentPromptId 的唯一事实源，这里只读不写；library 未加载完时保持 pending，
  // 否则会把「还不知道」误报成「默认提示词」。
  const scopeKey = resolveComposerPromptScopeKey(workspacePath, workspaceIdentity, sessionId);
  const resolvedPromptId = library ? (selected?.id ?? null) : undefined;
  useEffect(() => {
    if (resolvedPromptId === undefined) {
      markComposerPromptScopePending(scopeKey);
      return;
    }
    syncComposerPromptScope(scopeKey, resolvedPromptId);
  }, [resolvedPromptId, scopeKey]);
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

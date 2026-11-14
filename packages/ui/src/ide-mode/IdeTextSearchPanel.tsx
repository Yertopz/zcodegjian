import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CaseSensitive, X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useIdeTextSearch } from "@/hooks/useIdeTextSearch.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { WorkspaceTextSearchMatch } from "@zcode/services";
import {
  TID_IDE_TEXT_SEARCH_PANEL,
  TID_IDE_TEXT_SEARCH_INPUT,
  TID_IDE_TEXT_SEARCH_CASE,
  TID_IDE_TEXT_SEARCH_STATUS,
} from "@zcode/shared";

export function IdeTextSearchPanel({
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  visible,
  focusVersion,
  onOpenPreview,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  visible: boolean;
  focusVersion: number;
  onOpenPreview: (source: CodeViewerSource) => void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `ideMode.search.${key}` });
  const { state, controller } = useIdeTextSearch(
    workspacePath,
    workspaceIdentity,
    workspaceRemoteSessionId,
  );
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (visible) {
      input.current?.focus();
      input.current?.select();
    }
  }, [visible, focusVersion]);
  const groups = useMemo(() => {
    const files = new Map<string, WorkspaceTextSearchMatch[]>();
    for (const match of state.result?.matches ?? []) {
      const group = files.get(match.path) ?? [];
      group.push(match);
      files.set(match.path, group);
    }
    return Array.from(files.values());
  }, [state.result]);
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={t("title")}
      data-testid={TID_IDE_TEXT_SEARCH_PANEL}
    >
      <form
        className="shrink-0 space-y-2 border-b border-border/50 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          controller.search(query, caseSensitive);
        }}
      >
        <Input
          ref={input}
          value={query}
          maxLength={512}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          data-testid={TID_IDE_TEXT_SEARCH_INPUT}
          onChange={(event) => {
            setQuery(event.target.value);
            controller.cancel();
          }}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant={caseSensitive ? "secondary" : "ghost"}
            title={t("caseSensitive")}
            aria-label={t("caseSensitive")}
            aria-pressed={caseSensitive}
            data-testid={TID_IDE_TEXT_SEARCH_CASE}
            onClick={() => {
              setCaseSensitive((value) => !value);
              controller.cancel();
            }}
          >
            <CaseSensitive className="size-4" />
          </Button>
          <Button type="submit" size="sm" variant="ghost" disabled={!query || state.busy}>
            <Search className="size-3.5" />
            {t("run")}
          </Button>
          {state.busy ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("cancel")}
              onClick={() => controller.cancel()}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <p className="text-ui-caption text-foreground-subtlest">{t("hint")}</p>
      </form>
      <div className="min-h-0 flex-1 overflow-auto p-2" aria-busy={state.busy}>
        <div
          role="status"
          aria-live="polite"
          className="mb-2 text-ui-caption text-foreground-subtle"
          data-testid={TID_IDE_TEXT_SEARCH_STATUS}
        >
          {state.busy
            ? t("busy")
            : state.result
              ? intl.formatMessage(
                  { id: "ideMode.search.count" },
                  { lines: state.result.matches.length, files: groups.length },
                )
              : t("idle")}
        </div>
        {state.error ? (
          <p role="alert" className="text-ui-caption text-destructive">
            {t(state.error)}
          </p>
        ) : null}
        {state.result?.truncated ? (
          <p className="mb-2 text-ui-caption text-warning">{t("truncated")}</p>
        ) : null}
        {state.result && state.result.skippedFiles > 0 ? (
          <p className="mb-2 text-ui-caption text-foreground-subtle">
            {intl.formatMessage(
              { id: "ideMode.search.skipped" },
              { count: state.result.skippedFiles },
            )}
          </p>
        ) : null}
        {state.result?.matches.length === 0 && !state.result.truncated ? (
          <p className="text-ui-base text-foreground-subtle">{t("empty")}</p>
        ) : null}
        {groups.map((matches) => (
          <div key={matches[0]!.path} className="mb-3">
            <div className="mb-1 truncate text-ui-caption font-medium" title={matches[0]!.path}>
              {matches[0]!.relativePath}
            </div>
            {matches.map((match) => (
              <button
                key={match.lineNumber}
                type="button"
                data-ide-search-result=""
                data-path={match.path}
                data-line={match.lineNumber}
                title={`${match.path}:${match.lineNumber}:${match.columnNumber}`}
                aria-label={`${match.relativePath}:${match.lineNumber} ${match.preview}`}
                className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left text-ui-caption hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand"
                onClick={() =>
                  onOpenPreview({
                    type: "file",
                    title: match.relativePath,
                    path: match.path,
                    startLine: match.lineNumber,
                    endLine: match.lineNumber,
                    workspacePath,
                    workspaceIdentity,
                    workspaceRemoteSessionId,
                  })
                }
              >
                <span className="shrink-0 text-foreground-subtlest">{match.lineNumber}</span>
                <code className="min-w-0 truncate whitespace-pre text-foreground-subtle">
                  {match.preview.slice(0, match.matchStart)}
                  <mark className="rounded-sm bg-find-highlight text-foreground">
                    {match.preview.slice(match.matchStart, match.matchStart + match.matchLength)}
                  </mark>
                  {match.preview.slice(match.matchStart + match.matchLength)}
                </code>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

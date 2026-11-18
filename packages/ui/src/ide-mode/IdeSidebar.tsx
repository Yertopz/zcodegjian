import { forwardRef, useId, useImperativeHandle, useState } from "react";
import { Files, Search } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { WorkspaceFileTree } from "@/workspace-file-tree/WorkspaceFileTree.js";
import type { WorkspaceFileTreeProps } from "@/workspace-file-tree/types.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { IdeTextSearchPanel } from "./IdeTextSearchPanel.js";
import { TID_IDE_FILES_TAB, TID_IDE_SEARCH_TAB } from "@zcode/shared";

export interface IdeSidebarHandle {
  openSearch(): void;
}

type IdeSidebarProps = WorkspaceFileTreeProps & {
  onOpenPreview: NonNullable<WorkspaceFileTreeProps["onOpenPreview"]>;
};
export const IdeSidebar = forwardRef<IdeSidebarHandle, IdeSidebarProps>(
  function IdeSidebar(props, ref) {
    const { intl } = useZCodeIntl();
    const [mode, setMode] = useState<"files" | "search">("files");
    const [focusVersion, setFocusVersion] = useState(0);
    const id = useId();
    useImperativeHandle(
      ref,
      () => ({
        openSearch() {
          setMode("search");
          setFocusVersion((value) => value + 1);
        },
      }),
      [],
    );
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div
          className="flex shrink-0 items-center gap-1 border-b border-border/50 px-2 py-1"
          role="tablist"
          aria-label={intl.formatMessage({ id: "ideMode.search.sidebar" })}
        >
          {(["files", "search"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              role="tab"
              id={`${id}-${value}-tab`}
              aria-controls={`${id}-${value}`}
              aria-selected={mode === value}
              variant={mode === value ? "secondary" : "ghost"}
              size="sm"
              data-testid={value === "files" ? TID_IDE_FILES_TAB : TID_IDE_SEARCH_TAB}
              onClick={() => {
                setMode(value);
                if (value === "search") setFocusVersion((n) => n + 1);
              }}
            >
              {value === "files" ? <Files className="size-3.5" /> : <Search className="size-3.5" />}
              {intl.formatMessage({ id: `ideMode.search.${value}` })}
            </Button>
          ))}
        </div>
        {/* 文件树保持挂载，搜索/文件视图切换不丢目录展开与滚动位置。 */}
        <div
          id={`${id}-files`}
          role="tabpanel"
          aria-labelledby={`${id}-files-tab`}
          hidden={mode !== "files"}
          className="min-h-0 flex-1"
        >
          <WorkspaceFileTree {...props} />
        </div>
        <div
          id={`${id}-search`}
          role="tabpanel"
          aria-labelledby={`${id}-search-tab`}
          hidden={mode !== "search"}
          className="min-h-0 flex-1"
        >
          <IdeTextSearchPanel
            workspacePath={props.workspacePath}
            workspaceIdentity={props.workspaceIdentity}
            workspaceRemoteSessionId={props.workspaceRemoteSessionId}
            visible={mode === "search"}
            focusVersion={focusVersion}
            onOpenPreview={props.onOpenPreview}
          />
        </div>
      </div>
    );
  },
);

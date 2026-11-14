import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { X, FileCode, Save, RotateCcw } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getPathLeaf } from "@/lib/path.js";
import { isEditableIdeSource } from "@/lib/ideSource.js";
import type { IdeOpenRequest } from "@/store/ideEditorStore.js";
const PreviewPane = lazy(() =>
  import("@/PreviewPane.js").then((m) => ({ default: m.PreviewPane })),
);
import {
  useIdeEditorStore,
  selectIdeWorkspaceState,
  isIdeTabDirty,
  IDE_EDITOR_TAB_LIMIT,
  type IdeEditorTab,
} from "@/store/ideEditorStore.js";
import { createIdeEditorController } from "./ideEditorController.js";
import { IdeCodeEditor } from "./IdeCodeEditor.js";
import { createIdeEditorStateCache } from "./ideEditorStateCache.js";
import type { IdeEditorSession } from "./ideEditorSession.js";

export function IdeEditorPane({
  workspacePath,
  composerWorkspaceKey,
  workspaceIdentity,
  workspaceRemoteSessionId,
  requestedOpen,
  readOnly = false,
}: {
  workspacePath: string;
  composerWorkspaceKey: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  requestedOpen?: IdeOpenRequest;
  readOnly?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const services = useWorkspaceServices(workspacePath, workspaceRemoteSessionId, workspaceIdentity);
  const key = workspaceIdentity?.trim() || workspacePath;
  const workspace = useIdeEditorStore((state) => selectIdeWorkspaceState(state, key));
  // 面板持有纯界面缓存；关闭/重载失效由 store 标签快照驱动，不新增草稿所有者。
  const editorStateCache = useMemo(() => createIdeEditorStateCache<IdeEditorSession>(), [key]);
  useEffect(() => {
    editorStateCache.prune(workspace.tabs);
  }, [editorStateCache, workspace.tabs]);
  useEffect(() => () => editorStateCache.clear(), [editorStateCache]);
  const exitPending = useIdeEditorStore((state) => state.exitPending);
  const [confirming, setConfirming] = useState(false);
  const controller = useMemo(
    () => createIdeEditorController(key, services.fileService, readOnly),
    [key, services.fileService, readOnly],
  );
  const preview = workspace.previews.find((item) => item.id === workspace.activePreviewId);
  const active = workspace.tabs.find((tab) => tab.path === workspace.activeTabPath);
  const t = (id: string) => intl.formatMessage({ id });
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (!requestedOpen) return;
    let cancelled = false;
    void (async () => {
      // 批量入口固定快照；焦点与加载按请求顺序处理，切换工作区后不继续打开。
      for (const source of requestedOpen.sources) {
        if (cancelled) return;
        if (isEditableIdeSource(source) && source.path) {
          const kind = await controller.open(source.path);
          if (cancelled) return;
          const loaded = useIdeEditorStore
            .getState()
            .byWorkspaceKey[key]?.tabs.find((tab) => tab.path === source.path);
          if (
            loaded &&
            !loaded.docVersion &&
            /file_edit_(binary|too_large|invalid_utf8)/.test(loaded.loadError ?? "")
          ) {
            useIdeEditorStore.getState().closeTab(key, source.path);
            useIdeEditorStore.getState().openPreview(key, source);
          }
          if (kind === "limit")
            toast(
              intl.formatMessage(
                { id: "ideMode.tabLimitReached" },
                { limit: IDE_EDITOR_TAB_LIMIT },
              ),
            );
          const location =
            source.type === "code-review" ? source.review : source.type === "file" ? source : null;
          if (location?.startLine)
            useIdeEditorStore
              .getState()
              .locate(key, source.path, location.startLine, location.endLine);
        } else if (!useIdeEditorStore.getState().openPreview(key, source)) {
          toast(
            intl.formatMessage({ id: "ideMode.tabLimitReached" }, { limit: IDE_EDITOR_TAB_LIMIT }),
          );
        }
      }
      if (!cancelled) useIdeEditorStore.getState().finishOpenRequest(key, requestedOpen.sequence);
    })();
    return () => {
      cancelled = true;
    };
  }, [controller, requestedOpen, key, intl]);
  const changeVersions = useIdeEditorStore((state) => state.changeVersions);
  const seenChanges = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const tab of workspace.tabs) {
      const revision = changeVersions[`${key}\0${tab.path}`];
      if (!revision || seenChanges.current[tab.path] === revision) continue;
      if (tab.save || tab.loadState === "loading") continue;
      seenChanges.current[tab.path] = revision;
      void controller.refreshChangedFile(tab.path);
    }
  }, [changeVersions, controller, key, workspace.tabs]);

  async function discard(tab: IdeEditorTab, action: "close" | "reload") {
    if (confirming || exitPending || tab.save) return;
    setConfirming(true);
    try {
      if (isIdeTabDirty(tab)) {
        const confirmed = await useConfirmDialogStore.getState().requestConfirmation({
          title: t(
            action === "close" ? "ideMode.editorTabCloseDirtyConfirm" : "ideMode.reloadConfirm",
          ),
          confirmLabel: t("ideMode.discard"),
          cancelLabel: t("ideMode.cancel"),
          confirmVariant: "destructive",
          testId: "ide-discard-confirm",
        });
        if (!confirmed) return;
      }
      if (action === "close") useIdeEditorStore.getState().closeTab(key, tab.path);
      else await controller.reload(tab.path);
    } finally {
      setConfirming(false);
    }
  }
  function errorText(error: string) {
    if (error.includes("file_write_conflict")) return t("ideMode.writeConflict");
    if (error.includes("file_edit_binary")) return t("ideMode.binaryFile");
    if (error.includes("file_edit_too_large")) return t("ideMode.fileTooLarge");
    if (error === "ideMode.loadCancelled") return t(error);
    return intl.formatMessage({ id: "ideMode.operationFailed" }, { message: error });
  }
  const locked = exitPending || confirming;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-ide-editor-pane="">
      <div
        role="tablist"
        aria-label={t("ideMode.openFiles")}
        className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/50 bg-header px-1"
        data-ide-editor-tabs=""
      >
        {workspace.tabs.map((tab) => (
          <div key={tab.path} className="flex shrink-0 items-center">
            <button
              type="button"
              role="tab"
              aria-selected={!preview && tab.path === workspace.activeTabPath}
              title={tab.path}
              data-ide-editor-tab=""
              data-path={tab.path}
              data-active={(!preview && tab.path === workspace.activeTabPath) || undefined}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-ui-caption",
                !preview && tab.path === workspace.activeTabPath
                  ? "bg-accent text-foreground"
                  : "text-foreground-subtle hover:bg-surface-hover",
              )}
              onClick={() => useIdeEditorStore.getState().setActiveTab(key, tab.path)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const index = workspace.tabs.indexOf(tab);
                const next =
                  workspace.tabs[
                    (index + (event.key === "ArrowRight" ? 1 : -1) + workspace.tabs.length) %
                      workspace.tabs.length
                  ];
                if (!next) return;
                useIdeEditorStore.getState().setActiveTab(key, next.path);
                const buttons = event.currentTarget
                  .closest('[role="tablist"]')
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                buttons?.[workspace.tabs.indexOf(next)]?.focus();
              }}
            >
              <FileCode className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate">{getPathLeaf(tab.path)}</span>
              {isIdeTabDirty(tab) ? (
                <span
                  className="size-1.5 rounded-full bg-brand"
                  title={t("ideMode.unsavedIndicator")}
                  data-ide-dirty-dot=""
                />
              ) : null}
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={locked || Boolean(tab.save)}
              aria-label={t("ideMode.close")}
              onClick={() => void discard(tab, "close")}
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
        {workspace.previews.map((item) => (
          <div key={item.id} className="flex shrink-0 items-center">
            <button
              type="button"
              role="tab"
              aria-selected={item.id === workspace.activePreviewId}
              className="h-7 max-w-48 truncate rounded-md px-2 text-ui-caption hover:bg-surface-hover"
              title={item.source.path ?? item.source.title}
              onClick={() => useIdeEditorStore.getState().activatePreview(key, item.id)}
            >
              {item.source.title}
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={locked}
              aria-label={t("ideMode.close")}
              onClick={() => useIdeEditorStore.getState().closePreview(key, item.id)}
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>
      {!preview && active?.diskChanged ? (
        <div role="status" className="px-2 py-1 text-ui-sm text-foreground-subtle">
          {t("ideMode.diskChanged")}
        </div>
      ) : null}
      {!preview && active?.readOnly ? (
        <div role="status" className="px-2 py-1 text-ui-sm text-foreground-subtle">
          {t(readOnly ? "ideMode.readOnly" : "ideMode.legacyHost")}
        </div>
      ) : null}
      {!preview && (active?.loadError || active?.saveError) ? (
        <div
          role="alert"
          className="shrink-0 px-2 py-1 text-ui-sm text-destructive"
          data-testid="ide-editor-error"
        >
          {errorText(active.loadError || active.saveError!)}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {preview ? (
          <Suspense fallback={null}>
            <PreviewPane
              source={preview.source}
              workspacePath={workspacePath}
              onClose={() => useIdeEditorStore.getState().closePreview(key, preview.id)}
              onOpenCodeViewer={(source) =>
                useIdeEditorStore.getState().requestOpen(key, [source], {
                  workspacePath,
                  workspaceIdentity,
                  workspaceRemoteSessionId,
                })
              }
            />
          </Suspense>
        ) : active?.docVersion ? (
          <IdeCodeEditor
            stateCache={editorStateCache}
            tab={active}
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
            workspaceRemoteSessionId={workspaceRemoteSessionId}
            composerWorkspaceKey={composerWorkspaceKey}
            readOnly={readOnly || active.readOnly || active.loadState !== "ready" || locked}
            onChange={(content) =>
              useIdeEditorStore.getState().setDraftContent(key, active.path, content)
            }
            onSave={() => {
              if (!locked) void controller.save(active.path);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ui-sm text-foreground-subtle">
            {t(
              active
                ? active.loadState === "loading"
                  ? "ideMode.loading"
                  : "ideMode.loadFailed"
                : "ideMode.emptyEditor",
            )}
          </div>
        )}
      </div>
      {!preview && active ? (
        <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border/50 px-2">
          <span role="status" className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
            {t(
              active.save
                ? "ideMode.saving"
                : active.loadState === "loading"
                  ? "ideMode.loading"
                  : active.loadState === "error"
                    ? "ideMode.loadFailed"
                    : isIdeTabDirty(active)
                      ? "ideMode.unsavedIndicator"
                      : "ideMode.savedStatus",
            )}
          </span>
          <Button
            variant="ghost"
            size="xs"
            data-testid="ide-reload"
            disabled={locked || Boolean(active.save) || active.loadState === "loading"}
            onClick={() => void discard(active, "reload")}
          >
            <RotateCcw className="size-3.5" />
            {t(active.loadState === "error" ? "ideMode.retry" : "ideMode.reload")}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            data-testid="ide-save"
            disabled={
              locked ||
              readOnly ||
              active.readOnly ||
              Boolean(active.save) ||
              active.loadState !== "ready" ||
              !isIdeTabDirty(active)
            }
            onClick={() => void controller.save(active.path)}
          >
            <Save className="size-3.5" />
            {t("ideMode.save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

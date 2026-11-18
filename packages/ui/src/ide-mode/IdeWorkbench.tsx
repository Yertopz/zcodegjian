import { lazy, Suspense, useCallback, useRef, type ReactNode } from "react";
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from "@/components/ui/resizable.js";
import { IdeSidebar, type IdeSidebarHandle } from "./IdeSidebar.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { useIdeEditorStore } from "@/store/ideEditorStore.js";
import { useZCodeStore } from "@/store/StoreProvider.js";

// 轻量壳常驻保持聊天身份；只有编辑器实现进入独立懒 chunk。
const IdeEditorPane = lazy(() =>
  import("./IdeEditorPane.js").then((module) => ({ default: module.IdeEditorPane })),
);
const IDE_PANELS = ["ide-file-tree", "ide-editor", "ide-chat"];
const CHAT_PANELS = ["ide-chat"];
export function IdeWorkbench({
  enabled,
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  workspaceName,
  readOnly,
  chatSlot,
}: {
  enabled: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  workspaceName?: string;
  readOnly?: boolean;
  chatSlot: ReactNode;
}) {
  const key = workspaceIdentity?.trim() || workspacePath;
  const sidebar = useRef<IdeSidebarHandle>(null);
  // 文件树的返回按钮也走统一守卫，不能显示可点击但没有行为的入口。
  const previousMode = useZCodeStore((state) => state.previousInterfaceMode);
  const changeMode = useZCodeStore((state) => state.setInterfaceMode);
  const scope = useIdeEditorStore((state) => state.displayScopes[key]);
  const shownPath = scope?.workspacePath || workspacePath;
  const shownIdentity = scope ? scope.workspaceIdentity : workspaceIdentity;
  const shownRemote = scope ? scope.workspaceRemoteSessionId : workspaceRemoteSessionId;
  const shownKey = shownIdentity?.trim() || shownPath;
  const requestedOpen = useIdeEditorStore((state) => state.openRequests[shownKey]);
  const activePath = useIdeEditorStore((state) => {
    const ws = state.byWorkspaceKey[shownKey];
    return ws?.activePreviewId
      ? (ws.previews.find((p) => p.id === ws.activePreviewId)?.source.path ?? null)
      : (ws?.activeTabPath ?? null);
  });
  // 切换活动文件不改变打开入口；稳定回调使文件树未变化的可见行能复用。
  const openPreview = useCallback(
    (source: CodeViewerSource) => {
      useIdeEditorStore.getState().requestOpen(key, [source], {
        workspacePath: shownPath,
        workspaceIdentity: shownIdentity,
        workspaceRemoteSessionId: shownRemote,
      });
    },
    [key, shownPath, shownIdentity, shownRemote],
  );
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-ide-workbench={enabled ? "" : undefined}
      onKeyDownCapture={(event) => {
        if (
          enabled &&
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          sidebar.current?.openSearch();
        }
      }}
    >
      <ResizablePanelGroup
        orientation="horizontal"
        layoutId="ide-workbench-layout"
        panelIds={enabled ? IDE_PANELS : CHAT_PANELS}
        className="h-full min-h-0"
      >
        {enabled ? (
          <ResizablePanel
            key="ide-file-tree"
            id="ide-file-tree"
            defaultSize="20%"
            minSize="12%"
            maxSize="40%"
          >
            <IdeSidebar
              key={shownKey}
              ref={sidebar}
              workspacePath={shownPath}
              workspaceName={shownPath === workspacePath ? workspaceName : undefined}
              workspaceIdentity={shownIdentity}
              workspaceRemoteSessionId={shownRemote}
              activePreviewPath={activePath}
              onClose={() => void changeMode(previousMode)}
              onOpenPreview={openPreview}
            />
          </ResizablePanel>
        ) : null}
        {enabled ? <ResizableHandle key="tree-handle" id="ide-tree-resize" /> : null}
        {enabled ? (
          <ResizablePanel key="ide-editor" id="ide-editor" defaultSize="48%" minSize="25%">
            <Suspense fallback={null}>
              <IdeEditorPane
                key={shownKey}
                composerWorkspaceKey={key}
                workspacePath={shownPath}
                workspaceIdentity={shownIdentity}
                workspaceRemoteSessionId={shownRemote}
                requestedOpen={requestedOpen}
                readOnly={readOnly}
              />
            </Suspense>
          </ResizablePanel>
        ) : null}
        {enabled ? <ResizableHandle key="chat-handle" id="ide-chat-resize" /> : null}
        <ResizablePanel
          key="ide-chat"
          id="ide-chat"
          defaultSize={enabled ? "32%" : "100%"}
          minSize={enabled ? "18%" : "100%"}
        >
          <div className="h-full min-h-0 overflow-hidden">{chatSlot}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

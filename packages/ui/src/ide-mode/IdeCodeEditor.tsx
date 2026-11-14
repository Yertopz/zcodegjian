import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import {
  createIdeEditorSession,
  restoreIdeEditorSessionLanguage,
  ideEditorEditable,
  ideEditorTheme,
  loadIdeEditorSessionLanguage,
  type IdeEditorSession,
} from "./ideEditorSession.js";
import type { createIdeEditorStateCache } from "./ideEditorStateCache.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu.js";
import { dispatchCodeCommentAddToChat, type CodeCommentPayload } from "@/lib/codeCommentContext.js";
import { isIdeTabDirty } from "@/store/ideEditorStore.js";
import type { IdeEditorTab } from "../store/ideEditorStore.js";

export function IdeCodeEditor({
  tab,
  stateCache,
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  composerWorkspaceKey,
  readOnly,
  onChange,
  onSave,
}: {
  tab: IdeEditorTab;
  stateCache: ReturnType<typeof createIdeEditorStateCache<IdeEditorSession>>;
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  composerWorkspaceKey: string;
  readOnly: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}) {
  const { intl } = useZCodeIntl();
  const host = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState<CodeCommentPayload | null>(null);
  const view = useRef<EditorView | null>(null);
  const active = useRef<IdeEditorSession | null>(null);
  const callbacks = useRef({
    onChange,
    onSave,
    instanceId: tab.instanceId,
    docVersion: tab.docVersion,
  });
  callbacks.current = { onChange, onSave, instanceId: tab.instanceId, docVersion: tab.docVersion };
  const [languageFailed, setLanguageFailed] = useState(false);
  const parkState = useCallback(
    (editor: EditorView) => {
      const previous = active.current;
      if (!previous) return;
      previous.scrollSnapshot = editor.scrollSnapshot();
      previous.onLanguageSettled = undefined;
      // 非活动状态不保留组件回调；预览卸载后恢复时也不会调用旧 onChange/onSave。
      previous.state = editor.state.update({
        effects: previous.compartments.bindings.reconfigure([]),
      }).state;
      stateCache.put(previous);
      active.current = null;
    },
    [stateCache],
  );
  // 一个编辑区域只创建一个 View；路径/版本切换由下面的 setState 处理。
  useLayoutEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({ parent: host.current });
    view.current = editor;
    // 观察已应用主题，覆盖设置页、跨窗口以及 system 系统主题变化。
    const observer = new MutationObserver(() => {
      const session = active.current;
      if (!session) return;
      editor.dispatch({
        effects: session.compartments.theme.reconfigure(
          ideEditorTheme(document.documentElement.classList.contains("dark")),
        ),
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      parkState(editor);
      observer.disconnect();
      editor.destroy();
      view.current = null;
    };
  }, [parkState]);
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const previous = active.current;
    if (
      previous?.instanceId === tab.instanceId &&
      previous.docVersion === tab.docVersion &&
      previous.content === tab.draftContent
    ) {
      if (editor.state.readOnly !== readOnly) {
        editor.dispatch({
          effects: previous.compartments.editable.reconfigure(ideEditorEditable(readOnly)),
        });
      }
      return;
    }
    // 先取目标，避免保存当前页时恰好把 LRU 队尾将要激活的页淘汰。
    let session = stateCache.take(tab);
    parkState(editor);
    // 重载当前实例时不把刚刚保存的旧版本留在非活动缓存里。
    if (previous?.instanceId === tab.instanceId) stateCache.take(tab);
    if (!session) {
      session = createIdeEditorSession(
        tab,
        document.documentElement.classList.contains("dark"),
        readOnly,
      );
      void loadIdeEditorSessionLanguage(session);
    }
    const current = session;
    active.current = current;
    const isCurrent = () =>
      active.current === current &&
      callbacks.current.instanceId === current.instanceId &&
      callbacks.current.docVersion === current.docVersion;
    current.state = restoreIdeEditorSessionLanguage(current);
    current.state = current.state.update({
      effects: [
        current.compartments.theme.reconfigure(
          ideEditorTheme(document.documentElement.classList.contains("dark")),
        ),
        current.compartments.editable.reconfigure(ideEditorEditable(readOnly)),
        current.compartments.bindings.reconfigure([
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                if (isCurrent()) callbacks.current.onSave();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (active.current !== current) return;
            current.state = update.state;
            if (update.docChanged) {
              // sliceDoc 保留配置的 CRLF；store 保持草稿唯一所有者。
              current.content = current.bom + update.state.sliceDoc();
              if (isCurrent()) callbacks.current.onChange(current.content);
            }
          }),
        ]),
      ],
    }).state;
    editor.setState(current.state);
    if (current.scrollSnapshot) editor.dispatch({ effects: current.scrollSnapshot });
    current.onLanguageSettled = () => {
      if (active.current !== current || view.current !== editor) return;
      // 安装失败的通知也移除扩展，避免仅显示提示却继续保留失败配置。
      editor.dispatch({
        effects: current.compartments.language.reconfigure(current.language ?? []),
      });
      setLanguageFailed(current.languageStatus === "failed");
    };
    setLanguageFailed(current.languageStatus === "failed");
    setQuote(null);
  }, [parkState, stateCache, tab.instanceId, tab.docVersion, tab.draftContent, tab.path, readOnly]);
  useLayoutEffect(() => {
    const editor = view.current;
    const session = active.current;
    if (
      !editor ||
      !session ||
      !tab.location ||
      session.appliedLocationSequence === tab.location.sequence
    )
      return;
    const start = Math.max(1, Math.min(editor.state.doc.lines, tab.location.startLine));
    const end = Math.max(start, Math.min(editor.state.doc.lines, tab.location.endLine ?? start));
    editor.dispatch({
      selection: { anchor: editor.state.doc.line(start).from, head: editor.state.doc.line(end).to },
      effects: EditorView.scrollIntoView(editor.state.doc.line(start).from, { y: "center" }),
    });
    session.appliedLocationSequence = tab.location.sequence;
  }, [tab.instanceId, tab.docVersion, tab.location]);
  function snapshotSelection() {
    const editor = view.current;
    if (!editor || editor.state.selection.main.empty) {
      setQuote(null);
      return;
    }
    const { from, to } = editor.state.selection.main;
    setQuote({
      workspacePath,
      workspaceIdentity,
      workspaceRemoteSessionId,
      targetWorkspaceKey: composerWorkspaceKey,
      sourcePath: tab.path,
      sourceTitle: tab.path.split(/[\\/]/).pop() || tab.path,
      startLine: editor.state.doc.lineAt(from).number,
      endLine: editor.state.doc.lineAt(Math.max(from, to - 1)).number,
      selectedText: editor.state.sliceDoc(from, to),
      comment: "",
      hasUnsavedChanges: isIdeTabDirty(tab),
    });
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onContextMenuCapture={snapshotSelection}
          className="flex h-full min-h-0 flex-col"
          data-ide-code-editor=""
        >
          {languageFailed ? (
            <div role="status" className="shrink-0 px-2 py-1 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "ideMode.languageFailed" })}
            </div>
          ) : null}
          <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuItem
          disabled={!quote}
          onSelect={() => {
            if (quote) dispatchCodeCommentAddToChat(quote);
          }}
        >
          {intl.formatMessage({ id: "ideMode.addToChat" })}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

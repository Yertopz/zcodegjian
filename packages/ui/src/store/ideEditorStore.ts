import { create } from "zustand";
import type { IdeContext } from "@zcode/shared";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { ideFileKey, scopeIdeSource } from "../lib/ideSource.js";

import type { IdeEditorStore, IdeEditorTab, WorkspaceState } from "./ideEditorTypes.js";
export type { IdeEditorStore, IdeEditorTab, IdeOpenRequest } from "./ideEditorTypes.js";

export const IDE_EDITOR_TAB_LIMIT = 20;
// Zustand 的空快照必须稳定；每次返回 [] 会导致 useSyncExternalStore 循环渲染。
const EMPTY_WORKSPACE: WorkspaceState = {
  tabs: [],
  activeTabPath: null,
  previews: [],
  activePreviewId: null,
};
export function selectIdeWorkspaceState(state: IdeEditorStore, key: string): WorkspaceState {
  return state.byWorkspaceKey[key] ?? EMPTY_WORKSPACE;
}
export function isIdeTabDirty(tab: IdeEditorTab): boolean {
  return tab.draftContent !== tab.baseContent;
}
export function hasIdeSaving(state: IdeEditorStore): boolean {
  return Object.values(state.byWorkspaceKey).some((workspace) =>
    workspace.tabs.some((tab) => tab.save !== null),
  );
}
export function hasIdeDirty(state: IdeEditorStore): boolean {
  return Object.values(state.byWorkspaceKey).some((workspace) =>
    workspace.tabs.some(isIdeTabDirty),
  );
}

export const useIdeEditorStore = create<IdeEditorStore>()((set, get) => {
  // 不随清空复位，保证同路径关闭重开后请求身份也不会复用。
  let sequence = 0;
  const updateTab = (key: string, path: string, transform: (tab: IdeEditorTab) => IdeEditorTab) => {
    set((state) => {
      const workspace = state.byWorkspaceKey[key];
      if (!workspace) return state;
      let changed = false;
      const tabs = workspace.tabs.map((tab) => {
        if (tab.path !== path) return tab;
        const next = transform(tab);
        changed ||= next !== tab;
        return next;
      });
      return changed
        ? { byWorkspaceKey: { ...state.byWorkspaceKey, [key]: { ...workspace, tabs } } }
        : state;
    });
  };
  return {
    byWorkspaceKey: {},
    openRequests: {},
    displayScopes: {},
    changeVersions: {},
    requestOpen: (owner, sources, fallback) => {
      if (get().exitPending || !sources.length) return;
      const scoped = sources.map((source) => scopeIdeSource(source, fallback));
      const first = scoped[0]!;
      const groups = new Map<string, CodeViewerSource[]>();
      for (let source of scoped) {
        const key = source.workspaceIdentity?.trim() || source.workspacePath || owner;
        const existing =
          source.path &&
          get().byWorkspaceKey[key]?.tabs.find(
            (tab) => ideFileKey(tab.path) === ideFileKey(source.path!),
          );
        if (existing) source = { ...source, path: existing.path };
        groups.set(key, [...(groups.get(key) ?? []), source]);
      }
      const requests = { ...get().openRequests };
      for (const [key, group] of groups) requests[key] = { sources: group, sequence: ++sequence };
      set({
        openRequests: requests,
        displayScopes: {
          ...get().displayScopes,
          [owner]: {
            workspacePath: first.workspacePath,
            workspaceIdentity: first.workspaceIdentity,
            workspaceRemoteSessionId: first.workspaceRemoteSessionId,
          },
        },
      });
    },
    finishOpenRequest: (key, requestSequence) => {
      const requests = { ...get().openRequests };
      if (requests[key]?.sequence !== requestSequence) return;
      delete requests[key];
      set({ openRequests: requests });
    },
    openPreview: (key, source) => {
      const ws = selectIdeWorkspaceState(get(), key);
      const existing = ws.previews.find(
        (item) => JSON.stringify(item.source) === JSON.stringify(source),
      );
      if (!existing && ws.tabs.length + ws.previews.length >= IDE_EDITOR_TAB_LIMIT) return false;
      const preview = existing ?? { id: `preview-${++sequence}`, source: structuredClone(source) };
      set({
        byWorkspaceKey: {
          ...get().byWorkspaceKey,
          [key]: {
            ...ws,
            previews: existing ? ws.previews : [...ws.previews, preview],
            activePreviewId: preview.id,
          },
        },
      });
      return true;
    },
    activatePreview: (key, id) => {
      const ws = get().byWorkspaceKey[key];
      if (ws?.previews.some((p) => p.id === id))
        set({ byWorkspaceKey: { ...get().byWorkspaceKey, [key]: { ...ws, activePreviewId: id } } });
    },
    closePreview: (key, id) => {
      const ws = get().byWorkspaceKey[key];
      if (!ws || get().exitPending) return;
      const previews = ws.previews.filter((p) => p.id !== id);
      set({
        byWorkspaceKey: {
          ...get().byWorkspaceKey,
          [key]: {
            ...ws,
            previews,
            activePreviewId:
              ws.activePreviewId === id
                ? ws.activeTabPath
                  ? null
                  : (previews.at(-1)?.id ?? null)
                : ws.activePreviewId,
          },
        },
      });
    },
    locate: (key, path, startLine, endLine) =>
      updateTab(key, path, (tab) => ({
        ...tab,
        location: { startLine, endLine, sequence: ++sequence },
      })),
    markDiskChanged: (key, path) => updateTab(key, path, (tab) => ({ ...tab, diskChanged: true })),
    notifyFileChanges: (key, paths, fact) => {
      const versions = { ...get().changeVersions };
      // 事件路径可能使用另一种 Windows 分隔符；只保留已打开文件的变化事实。
      const changed = new Set(paths.map(ideFileKey));
      for (const tab of get().byWorkspaceKey[key]?.tabs ?? []) {
        // 重复展开不是新的修改；是否真的变化由 controller 比较磁盘版本，不比较两台主机的时钟。
        if (!changed.has(ideFileKey(tab.path)) || (fact && fact.id === tab.lastChangeFact))
          continue;
        versions[`${key}\0${tab.path}`] = ++sequence;
        if (fact) updateTab(key, tab.path, (current) => ({ ...current, lastChangeFact: fact.id }));
      }
      set({ changeVersions: versions });
    },
    exitPending: false,
    openTab: (key, path) => {
      if (get().exitPending) return { kind: "blocked" };
      const workspace = selectIdeWorkspaceState(get(), key);
      const existing = workspace.tabs.find((tab) => ideFileKey(tab.path) === ideFileKey(path));
      if (existing) {
        get().setActiveTab(key, existing.path);
        return { kind: "focused" };
      }
      if (workspace.tabs.length + workspace.previews.length >= IDE_EDITOR_TAB_LIMIT)
        return { kind: "limit" };
      const requestId = ++sequence;
      const tab: IdeEditorTab = {
        path,
        instanceId: requestId,
        baseVersion: null,
        baseContent: "",
        draftContent: "",
        loadState: "loading",
        loadRequest: requestId,
        readOnly: false,
        docVersion: 0,
        save: null,
      };
      set({
        byWorkspaceKey: {
          ...get().byWorkspaceKey,
          [key]: {
            ...workspace,
            tabs: [...workspace.tabs, tab],
            activeTabPath: path,
            activePreviewId: null,
          },
        },
      });
      return { kind: "opened", requestId };
    },
    beginReload: (key, path) => {
      const tab = get().byWorkspaceKey[key]?.tabs.find((item) => item.path === path);
      if (!tab || tab.save || get().exitPending || tab.loadRequest !== null) return null;
      const id = ++sequence;
      updateTab(key, path, (current) => ({
        ...current,
        loadState: "loading",
        loadRequest: id,
        loadError: undefined,
      }));
      return id;
    },
    loadSucceeded: (key, path, id, snapshot, readOnly = false) => {
      updateTab(key, path, (tab) =>
        tab.loadRequest !== id
          ? tab
          : {
              ...tab,
              baseVersion: readOnly ? null : snapshot.version,
              baseContent: snapshot.content,
              draftContent: snapshot.content,
              loadState: "ready",
              loadRequest: null,
              diskChanged: false,
              loadError: undefined,
              saveError: undefined,
              readOnly,
              // 相同快照不重建 CodeMirror；摘要刷新不能清空光标和撤销历史。
              docVersion:
                tab.docVersion &&
                tab.baseVersion === snapshot.version &&
                tab.draftContent === snapshot.content
                  ? tab.docVersion
                  : tab.docVersion + 1,
            },
      );
    },
    loadFailed: (key, path, id, error) => {
      updateTab(key, path, (tab) =>
        tab.loadRequest !== id
          ? tab
          : {
              ...tab,
              loadRequest: null,
              loadState: tab.docVersion ? "ready" : "error",
              loadError: error,
            },
      );
    },
    cancelLoads: (key) => {
      for (const tab of get().byWorkspaceKey[key]?.tabs ?? []) {
        if (tab.loadRequest !== null)
          get().loadFailed(key, tab.path, tab.loadRequest, "ideMode.loadCancelled");
      }
    },
    closeTab: (key, path) => {
      const workspace = get().byWorkspaceKey[key];
      const index = workspace?.tabs.findIndex((tab) => tab.path === path) ?? -1;
      const target = workspace?.tabs[index];
      if (!workspace || !target || target.save || get().exitPending) return false;
      const tabs = workspace.tabs.filter((tab) => tab.path !== path);
      set({
        byWorkspaceKey: {
          ...get().byWorkspaceKey,
          [key]: {
            ...workspace,
            tabs,
            activeTabPath:
              workspace.activeTabPath === path
                ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null)
                : workspace.activeTabPath,
          },
        },
      });
      return true;
    },
    setActiveTab: (key, path) => {
      const workspace = get().byWorkspaceKey[key];
      if (
        !workspace ||
        (workspace.activeTabPath === path && !workspace.activePreviewId) ||
        !workspace.tabs.some((tab) => tab.path === path)
      )
        return;
      set({
        byWorkspaceKey: {
          ...get().byWorkspaceKey,
          [key]: { ...workspace, activeTabPath: path, activePreviewId: null },
        },
      });
    },
    setDraftContent: (key, path, content) => {
      if (get().exitPending) return;
      updateTab(key, path, (tab) =>
        tab.loadState !== "ready" || tab.readOnly || tab.draftContent === content
          ? tab
          : { ...tab, draftContent: content },
      );
    },
    beginSave: (key, path) => {
      const tab = get().byWorkspaceKey[key]?.tabs.find((item) => item.path === path);
      if (
        !tab ||
        tab.save ||
        tab.loadState !== "ready" ||
        !tab.baseVersion ||
        tab.readOnly ||
        !isIdeTabDirty(tab) ||
        get().exitPending
      )
        return null;
      const save = {
        requestId: ++sequence,
        content: tab.draftContent,
        expectedVersion: tab.baseVersion,
      };
      updateTab(key, path, (current) => ({ ...current, save, saveError: undefined }));
      return save;
    },
    saveSucceeded: (key, path, id, version) => {
      updateTab(key, path, (tab) =>
        tab.save?.requestId !== id
          ? tab
          : {
              // 只能确认实际提交的内容，不能把 RPC 等待期间新输入的草稿也标记为已保存。
              ...tab,
              baseContent: tab.save.content,
              baseVersion: version,
              save: null,
              saveError: undefined,
            },
      );
    },
    saveFailed: (key, path, id, error) => {
      updateTab(key, path, (tab) =>
        tab.save?.requestId !== id ? tab : { ...tab, save: null, saveError: error },
      );
    },
    setExitPending: (exitPending) => set({ exitPending }),
    clearAll: () =>
      set({
        byWorkspaceKey: {},
        openRequests: {},
        displayScopes: {},
        changeVersions: {},
        exitPending: false,
      }),
  };
});

/** 点击发送同步读取，后续排队/重试不得重新读取当前标签。 */
export function snapshotIdeContext(owner: string): IdeContext {
  const state = useIdeEditorStore.getState();
  const scope = state.displayScopes[owner];
  const key = scope?.workspaceIdentity?.trim() || scope?.workspacePath || owner;
  const ws = state.byWorkspaceKey[key];
  const preview = ws?.previews.find((p) => p.id === ws.activePreviewId);
  const path = preview ? preview.source.path : ws?.activeTabPath;
  // 差异记录的 Windows 大小写/分隔符可以不同，未保存状态必须来自同一文件的唯一草稿。
  const tab = path ? ws?.tabs.find((t) => ideFileKey(t.path) === ideFileKey(path)) : undefined;
  return {
    version: 1,
    activeFile: path
      ? { absolutePath: path, hasUnsavedChanges: tab ? isIdeTabDirty(tab) : false }
      : null,
  };
}

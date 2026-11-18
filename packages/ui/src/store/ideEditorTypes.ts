import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { CodeViewerWorkspaceScope } from "@/lib/codeViewerWorkspaceScope.js";

/** 编辑会话唯一 owner；磁盘为事实来源，草稿与请求只在当前 renderer 内存中存活。 */
export interface IdeEditorTab {
  path: string;
  instanceId: number;
  lastChangeFact?: string;
  baseVersion: string | null;
  baseContent: string;
  draftContent: string;
  loadState: "loading" | "ready" | "error";
  loadRequest: number | null;
  loadError?: string;
  readOnly: boolean;
  docVersion: number;
  save: IdeSaveRequest | null;
  saveError?: string;
  diskChanged?: boolean;
  location?: { startLine: number; endLine?: number; sequence: number };
}
export interface IdeSaveRequest {
  requestId: number;
  content: string;
  expectedVersion: string;
}
export interface IdePreview {
  id: string;
  source: CodeViewerSource;
}
export interface IdeOpenRequest {
  sources: readonly CodeViewerSource[];
  sequence: number;
}
export interface WorkspaceState {
  previews: IdePreview[];
  activePreviewId: string | null;
  tabs: IdeEditorTab[];
  activeTabPath: string | null;
}
type OpenResult = { kind: "opened"; requestId: number } | { kind: "focused" | "limit" | "blocked" };
export interface IdeEditorStore {
  byWorkspaceKey: Record<string, WorkspaceState>;
  exitPending: boolean;
  openRequests: Record<string, IdeOpenRequest>;
  displayScopes: Record<string, CodeViewerWorkspaceScope>;
  changeVersions: Record<string, number>;
  requestOpen: (
    owner: string,
    sources: readonly CodeViewerSource[],
    fallback: CodeViewerWorkspaceScope,
  ) => void;
  finishOpenRequest: (key: string, sequence: number) => void;
  openPreview: (key: string, source: CodeViewerSource) => boolean;
  closePreview: (key: string, id: string) => void;
  activatePreview: (key: string, id: string) => void;
  locate: (key: string, path: string, startLine: number, endLine?: number) => void;
  notifyFileChanges: (key: string, paths: readonly string[], fact?: { id: string }) => void;
  markDiskChanged: (key: string, path: string) => void;
  openTab: (key: string, path: string) => OpenResult;
  beginReload: (key: string, path: string) => number | null;
  loadSucceeded: (
    key: string,
    path: string,
    id: number,
    snapshot: { content: string; version: string },
    readOnly?: boolean,
  ) => void;
  loadFailed: (key: string, path: string, id: number, error: string) => void;
  cancelLoads: (key: string) => void;
  closeTab: (key: string, path: string) => boolean;
  setActiveTab: (key: string, path: string) => void;
  setDraftContent: (key: string, path: string, content: string) => void;
  beginSave: (key: string, path: string) => IdeSaveRequest | null;
  saveSucceeded: (key: string, path: string, id: number, version: string) => void;
  saveFailed: (key: string, path: string, id: number, error: string) => void;
  setExitPending: (value: boolean) => void;
  clearAll: () => void;
}

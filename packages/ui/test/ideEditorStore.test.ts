import assert from "node:assert/strict";
import test from "node:test";
import {
  useIdeEditorStore as store,
  IDE_EDITOR_TAB_LIMIT,
  selectIdeWorkspaceState,
  snapshotIdeContext,
} from "../src/store/ideEditorStore.js";
import { normalizeInterfaceMode } from "../src/lib/interfaceMode.js";

const key = "ide-test";

test("Windows 差异路径大小写不同仍引用同一草稿的未保存状态", () => {
  store.getState().clearAll();
  const path = "C:/project/Current.ts";
  const opened = store.getState().openTab(key, path);
  if (opened.kind !== "opened") throw Error("not opened");
  store.getState().loadSucceeded(key, path, opened.requestId, { content: "disk", version: "v1" });
  store.getState().setDraftContent(key, path, "draft");
  store
    .getState()
    .openPreview(key, { type: "patch", title: "diff", path: "c:/project/current.ts", patch: "" });
  assert.equal(snapshotIdeContext(key).activeFile?.hasUnsavedChanges, true);
});

test("IDE previews do not replace source drafts; scope identity and submitted snapshots stay isolated", () => {
  store.getState().clearAll();
  const a = "remote-a";
  const b = "remote-b";
  const path = "/project/same.ts";
  for (const scope of [a, b]) {
    const opened = store.getState().openTab(scope, path);
    if (opened.kind !== "opened") throw new Error("not opened");
    store
      .getState()
      .loadSucceeded(scope, path, opened.requestId, { content: scope, version: scope });
  }
  store.getState().setDraftContent(a, path, "unsaved-a");
  const source = {
    type: "patch" as const,
    title: "same.ts",
    path,
    patch: "--- a\n+++ b",
    workspacePath: "/project",
    workspaceIdentity: a,
    workspaceRemoteSessionId: "connection-a",
  };
  store.getState().requestOpen("owner", [source], { workspacePath: "C:/project" });
  store.getState().openPreview(a, source);
  const captured = snapshotIdeContext("owner");
  store
    .getState()
    .requestOpen(
      "owner",
      [{ ...source, workspaceIdentity: b, workspaceRemoteSessionId: "connection-b" }],
      {},
    );
  assert.equal(captured.activeFile?.absolutePath, path);
  assert.equal(captured.activeFile?.hasUnsavedChanges, true);
  assert.equal(store.getState().byWorkspaceKey[a]?.tabs[0]?.draftContent, "unsaved-a");
  assert.equal(store.getState().byWorkspaceKey[b]?.tabs[0]?.draftContent, b);
  store
    .getState()
    .openPreview(b, { type: "text", title: "snippet", content: "code", language: "typescript" });
  assert.equal(snapshotIdeContext("owner").activeFile, null);
  store.getState().clearAll();
  assert.deepEqual(store.getState().displayScopes, {});
});
const tab = () => store.getState().byWorkspaceKey[key]?.tabs[0];
test("Windows 路径别名复用草稿，重复修改与旧打开请求不能重放", () => {
  store.getState().clearAll();
  const state = store.getState();
  state.openTab(key, "C:/project/a.ts");
  assert.equal(state.openTab(key, "c:\\project\\A.ts").kind, "focused");
  assert.equal(store.getState().byWorkspaceKey[key].tabs.length, 1);
  state.notifyFileChanges(key, ["c:\\project\\A.ts"], { id: "new" });
  const revisions = store.getState().changeVersions;
  state.notifyFileChanges(key, ["C:/project/a.ts"], { id: "new" });
  assert.deepEqual(store.getState().changeVersions, revisions);
  const source = { type: "file" as const, title: "a", path: "C:/project/a.ts" };
  state.requestOpen(key, [source], { workspaceIdentity: key, workspacePath: "C:/project" });
  const first = store.getState().openRequests[key].sequence;
  state.requestOpen(key, [source], { workspaceIdentity: key, workspacePath: "C:/project" });
  state.finishOpenRequest(key, first);
  assert.ok(store.getState().openRequests[key]);
  state.finishOpenRequest(key, store.getState().openRequests[key].sequence);
  assert.equal(store.getState().openRequests[key], undefined);
});
function ready(content = "disk") {
  store.getState().clearAll();
  const result = store.getState().openTab(key, "/a.ts");
  assert.equal(result.kind, "opened");
  if (result.kind !== "opened") throw new Error("not opened");
  store.getState().loadSucceeded(key, "/a.ts", result.requestId, { content, version: "v1" });
}
test("两阶段加载真正回填，重复打开只聚焦，空快照引用稳定", () => {
  store.getState().clearAll();
  assert.equal(
    selectIdeWorkspaceState(store.getState(), key),
    selectIdeWorkspaceState(store.getState(), key),
  );
  const result = store.getState().openTab(key, "/a.ts");
  assert.equal(result.kind, "opened");
  if (result.kind !== "opened") return;
  assert.equal(tab()?.loadState, "loading");
  assert.equal(store.getState().beginSave(key, "/a.ts"), null);
  store
    .getState()
    .loadSucceeded(key, "/a.ts", result.requestId, { content: "disk", version: "v1" });
  assert.equal(tab()?.draftContent, "disk");
  store.getState().setDraftContent(key, "/a.ts", "draft");
  assert.equal(store.getState().openTab(key, "/a.ts").kind, "focused");
  assert.equal(tab()?.draftContent, "draft");
});
test("保存期间的新编辑不被标记为已保存，重复保存不重入", () => {
  ready();
  store.getState().setDraftContent(key, "/a.ts", "submitted");
  const save = store.getState().beginSave(key, "/a.ts");
  assert.ok(save);
  assert.equal(store.getState().beginSave(key, "/a.ts"), null);
  store.getState().setDraftContent(key, "/a.ts", "typed during save");
  assert.equal(store.getState().closeTab(key, "/a.ts"), false);
  store.getState().saveSucceeded(key, "/a.ts", save.requestId, "v2");
  assert.equal(tab()?.baseContent, "submitted");
  assert.equal(tab()?.draftContent, "typed during save");
  assert.equal(tab()?.baseVersion, "v2");
});
test("失败保存/重载保留草稿，并可重试", () => {
  ready();
  store.getState().setDraftContent(key, "/a.ts", "draft");
  const save = store.getState().beginSave(key, "/a.ts")!;
  store.getState().saveFailed(key, "/a.ts", save.requestId, "permission");
  assert.equal(tab()?.draftContent, "draft");
  const load = store.getState().beginReload(key, "/a.ts")!;
  store.getState().loadFailed(key, "/a.ts", load, "read failed");
  assert.equal(tab()?.loadState, "ready");
  assert.equal(tab()?.draftContent, "draft");
  const retry = store.getState().beginReload(key, "/a.ts")!;
  store.getState().loadSucceeded(key, "/a.ts", retry, { content: "fresh", version: "v3" });
  assert.equal(tab()?.draftContent, "fresh");
});
test("关闭重开与切换作用域后，过期读取不污染标签", () => {
  store.getState().clearAll();
  const old = store.getState().openTab(key, "/a.ts");
  if (old.kind !== "opened") throw new Error("not opened");
  store.getState().closeTab(key, "/a.ts");
  const next = store.getState().openTab(key, "/a.ts");
  if (next.kind !== "opened") throw new Error("not opened");
  store.getState().loadSucceeded(key, "/a.ts", old.requestId, { content: "stale", version: "v1" });
  assert.equal(tab()?.loadState, "loading");
  store.getState().cancelLoads(key);
  store.getState().loadSucceeded(key, "/a.ts", next.requestId, { content: "late", version: "v2" });
  assert.notEqual(tab()?.draftContent, "late");
});
test("作用域隔离、标签上限与退出期间冻结", () => {
  ready("");
  assert.equal(store.getState().beginSave(key, "/a.ts"), null);
  for (let i = 1; i < IDE_EDITOR_TAB_LIMIT; i++) store.getState().openTab(key, "/" + i);
  assert.equal(store.getState().openTab(key, "/overflow").kind, "limit");
  assert.equal(store.getState().openTab("other", "/a.ts").kind, "opened");
  store.getState().setExitPending(true);
  store.getState().setDraftContent(key, "/a.ts", "blocked");
  assert.equal(tab()?.draftContent, "");
  assert.equal(store.getState().openTab(key, "/blocked").kind, "blocked");
  store.getState().setExitPending(false);
  store.getState().clearAll();
  assert.deepEqual(store.getState().byWorkspaceKey, {});
  assert.equal(normalizeInterfaceMode("ide"), "ide");
  assert.equal(normalizeInterfaceMode("concise"), "office");
});

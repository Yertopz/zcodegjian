import assert from "node:assert/strict";
import test from "node:test";
import { createIdeEditorController } from "../src/ide-mode/ideEditorController.js";
import { useIdeEditorStore as store } from "../src/store/ideEditorStore.js";
import type { IFileService } from "@zcode/services";
type FileApi = Pick<IFileService, "readTextFileForEdit" | "readTextFile" | "writeTextFile">;
test("明确修改刷新干净标签、保留脏草稿，删除后仍能查看原稿与差异", async () => {
  store.getState().clearAll();
  let content = "disk";
  let deleted = false;
  const controller = createIdeEditorController(
    "changes",
    fileApi({
      readTextFileForEdit: async () => {
        if (deleted) throw Error("ENOENT");
        return { content, version: content };
      },
    }),
  );
  await controller.open("/a.ts");
  const tab = () => store.getState().byWorkspaceKey.changes.tabs[0];
  const documentVersion = tab().docVersion;
  await controller.refreshChangedFile("/a.ts");
  assert.equal(tab().docVersion, documentVersion);
  content = "agent edit";
  await controller.refreshChangedFile("/a.ts");
  assert.equal(tab().draftContent, content);
  store.getState().setDraftContent("changes", "/a.ts", "unsaved");
  await controller.refreshChangedFile("/a.ts");
  assert.equal(tab().diskChanged, false, "历史摘要不能把未变化的磁盘误报为修改");
  content = "second agent edit";
  await controller.refreshChangedFile("/a.ts");
  assert.equal(tab().draftContent, "unsaved");
  assert.equal(tab().diskChanged, true);
  deleted = true;
  await controller.reload("/a.ts");
  assert.equal(tab().draftContent, "unsaved");
  assert.match(tab().loadError!, /ENOENT/);
  store.getState().openPreview("changes", {
    type: "patch",
    title: "deleted",
    path: "/a.ts",
    patch: "--- a/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-agent edit",
  });
  assert.equal(store.getState().byWorkspaceKey.changes.previews.length, 1);
  assert.equal(tab().draftContent, "unsaved");
});
function fileApi(overrides: Partial<FileApi> = {}): FileApi {
  return {
    readTextFileForEdit: async () => ({ content: "disk", version: "v1" }),
    readTextFile: async ({ path }) => ({
      path,
      content: "legacy",
      offset: 0,
      bytesRead: 6,
      totalBytes: 6,
      truncated: false,
      isBinary: false,
    }),
    writeTextFile: async () => ({ version: "v2" }),
    ...overrides,
  };
}
test("迟到的磁盘版本核对不能标记关闭后重开的草稿", async () => {
  store.getState().clearAll();
  let delayed = false;
  let finish!: (snapshot: { content: string; version: string }) => void;
  const controller = createIdeEditorController(
    "late-change",
    fileApi({
      readTextFileForEdit: () =>
        delayed
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({ content: "disk", version: "v1" }),
    }),
  );
  await controller.open("/a");
  store.getState().setDraftContent("late-change", "/a", "old draft");
  delayed = true;
  const checking = controller.refreshChangedFile("/a");
  store.getState().closeTab("late-change", "/a");
  delayed = false;
  await controller.open("/a");
  store.getState().setDraftContent("late-change", "/a", "new draft");
  finish({ content: "stale observation", version: "v2" });
  await checking;
  assert.equal(store.getState().byWorkspaceKey["late-change"].tabs[0].diskChanged, false);
});
test("真实编排加载内容/保存快照，等待写盘时输入不丢失", async () => {
  store.getState().clearAll();
  let finish!: (value: { version: string }) => void;
  let submitted = "";
  const controller = createIdeEditorController(
    "scope",
    fileApi({
      writeTextFile: (request) => {
        submitted = request.content;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  await controller.open("/a");
  assert.equal(store.getState().byWorkspaceKey.scope.tabs[0].draftContent, "disk");
  store.getState().setDraftContent("scope", "/a", "submitted");
  const saving = controller.save("/a");
  await controller.save("/a");
  store.getState().setDraftContent("scope", "/a", "later");
  finish({ version: "v2" });
  await saving;
  const tab = store.getState().byWorkspaceKey.scope.tabs[0];
  assert.equal(submitted, "submitted");
  assert.equal(tab.baseContent, submitted);
  assert.equal(tab.draftContent, "later");
});
test("旧 Host 仅精确缺方法时降级只读，权限失败不能降级", async () => {
  store.getState().clearAll();
  const controller = createIdeEditorController(
    "legacy",
    fileApi({
      readTextFileForEdit: async () => {
        throw Error("Method not found: readTextFileForEdit");
      },
      writeTextFile: async () => assert.fail("legacy must not save"),
    }),
  );
  await controller.open("/a");
  const tab = store.getState().byWorkspaceKey.legacy.tabs[0];
  assert.equal(tab.readOnly, true);
  assert.equal(tab.draftContent, "legacy");
  store.getState().setDraftContent("legacy", "/a", "unsafe");
  await controller.save("/a");
  assert.equal(store.getState().byWorkspaceKey.legacy.tabs[0].draftContent, "legacy");
  const denied = createIdeEditorController(
    "denied",
    fileApi({
      readTextFileForEdit: async () => {
        throw Error("EACCES");
      },
      readTextFile: async () => assert.fail("permission must not fall back"),
    }),
  );
  await denied.open("/a");
  assert.equal(store.getState().byWorkspaceKey.denied.tabs[0].loadState, "error");
});
test("切换工作区后的迟到加载无效，重复点已打开文件不重读", async () => {
  store.getState().clearAll();
  let finish!: (value: { content: string; version: string }) => void;
  let reads = 0;
  const controller = createIdeEditorController(
    "scope",
    fileApi({
      readTextFileForEdit: () => {
        reads++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  const opening = controller.open("/a");
  await controller.open("/a");
  assert.equal(reads, 1);
  controller.dispose();
  finish({ content: "late", version: "v1" });
  await opening;
  assert.notEqual(store.getState().byWorkspaceKey.scope.tabs[0].draftContent, "late");
});

test("保存权限/冲突和重载失败都保留草稿，重试成功才替换文档", async () => {
  store.getState().clearAll();
  let readFailed = false;
  let saveError = "EACCES";
  const controller = createIdeEditorController(
    "scope",
    fileApi({
      readTextFileForEdit: async () => {
        if (readFailed) throw Error("EACCES");
        return { content: "disk", version: "v1" };
      },
      writeTextFile: async () => {
        throw Error(saveError);
      },
    }),
  );
  await controller.open("/a");
  store.getState().setDraftContent("scope", "/a", "draft");
  for (const reason of ["EACCES", "file_write_conflict"]) {
    saveError = reason;
    await controller.save("/a");
    const tab = store.getState().byWorkspaceKey.scope.tabs[0];
    assert.equal(tab.draftContent, "draft");
    assert.equal(tab.baseContent, "disk");
    assert.equal(tab.saveError, reason);
  }
  readFailed = true;
  await controller.reload("/a");
  assert.equal(store.getState().byWorkspaceKey.scope.tabs[0].draftContent, "draft");
  readFailed = false;
  await controller.reload("/a");
  assert.equal(store.getState().byWorkspaceKey.scope.tabs[0].draftContent, "disk");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createIdeModeTransition } from "../src/lib/ideModeTransition.js";
import { useIdeEditorStore as editor } from "../src/store/ideEditorStore.js";
import type { InterfaceMode } from "../src/lib/interfaceMode.js";
function seed() {
  editor.getState().clearAll();
  const opened = editor.getState().openTab("other-workspace", "/a");
  if (opened.kind !== "opened") throw Error("open");
  editor
    .getState()
    .loadSucceeded("other-workspace", "/a", opened.requestId, { content: "disk", version: "v1" });
  editor.getState().setDraftContent("other-workspace", "/a", "draft");
}
test("取消退出保留其他工作区草稿，广播请求也不能绕过确认", async () => {
  seed();
  let mode: InterfaceMode = "ide";
  const commits: boolean[] = [];
  const transition = createIdeModeTransition({
    editor,
    getMode: () => mode,
    commit: (next, broadcast) => {
      mode = next;
      commits.push(broadcast);
    },
    confirmDiscard: async () => false,
    notifySaving: () => assert.fail("not saving"),
  });
  assert.equal(await transition.request("office", true), false);
  assert.equal(mode, "ide");
  assert.equal(editor.getState().byWorkspaceKey["other-workspace"].tabs[0].draftContent, "draft");
  assert.equal(editor.getState().exitPending, false);
  assert.deepEqual(commits, []);
});
test("确认退出一次清空全部，广播来源传到同步提交以抑制回环", async () => {
  seed();
  let mode: InterfaceMode = "ide";
  const transition = createIdeModeTransition({
    editor,
    getMode: () => mode,
    commit: (next, broadcast) => {
      assert.equal(broadcast, true);
      mode = next;
    },
    confirmDiscard: async () => {
      assert.equal(editor.getState().exitPending, true);
      return true;
    },
    notifySaving: () => assert.fail("not saving"),
  });
  assert.equal(await transition.request("coding", true), true);
  assert.deepEqual(editor.getState().byWorkspaceKey, {});
  assert.equal(mode, "coding");
});
test("保存中拒绝退出，不显示丢弃框；等待确认时不接受第二个请求", async () => {
  seed();
  editor.getState().beginSave("other-workspace", "/a");
  let notified = false;
  const transition = createIdeModeTransition({
    editor,
    getMode: () => "ide",
    commit: () => assert.fail("must not commit"),
    confirmDiscard: async () => assert.fail("must not confirm"),
    notifySaving: () => {
      notified = true;
    },
  });
  assert.equal(await transition.request("coding"), false);
  assert.equal(notified, true);
  seed();
  let settle!: (value: boolean) => void;
  const pending = createIdeModeTransition({
    editor,
    getMode: () => "ide",
    commit: () => {},
    confirmDiscard: () =>
      new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
    notifySaving: () => {},
  });
  const first = pending.request("office");
  assert.equal(await pending.request("coding"), false);
  settle(false);
  assert.equal(await first, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { EditorView } from "@codemirror/view";
import { redo, undo, undoDepth } from "@codemirror/commands";
import { StateField, type Extension, type Transaction } from "@codemirror/state";
import type { IdeEditorTab } from "../src/store/ideEditorTypes.js";
import {
  createIdeEditorSession,
  restoreIdeEditorSessionLanguage,
  ideEditorEditable,
  ideEditorTheme,
  loadIdeEditorSessionLanguage,
} from "../src/ide-mode/ideEditorSession.js";
import { createIdeEditorStateCache } from "../src/ide-mode/ideEditorStateCache.js";

function tab(instanceId: number, draftContent: string): IdeEditorTab {
  return {
    instanceId,
    path: `/workspace/${instanceId}.ts`,
    docVersion: 1,
    baseVersion: "v1",
    baseContent: draftContent,
    draftContent,
    loadState: "ready",
    loadRequest: null,
    readOnly: false,
    save: null,
  };
}

test("缓存恢复和主题/只读重配置保留 BOM、CRLF、选区和真实 undo/redo", () => {
  const source = tab(1, "\ufeffone\r\ntwo\r\n");
  const session = createIdeEditorSession(source, false, false);
  session.state = session.state.update({
    changes: { from: 0, insert: "new " },
    selection: { anchor: 5 },
  }).state;
  session.content = session.bom + session.state.sliceDoc();
  const cache = createIdeEditorStateCache<typeof session>();
  cache.put(session);
  const restored = cache.take({ ...source, draftContent: session.content })!;
  restored.state = restored.state.update({
    effects: [
      restored.compartments.theme.reconfigure(ideEditorTheme(true)),
      restored.compartments.editable.reconfigure(ideEditorEditable(true)),
      restored.compartments.bindings.reconfigure([]),
    ],
  }).state;
  assert.equal(restored.state.readOnly, true);
  assert.equal(restored.state.facet(EditorView.editable), false);
  assert.equal(restored.state.selection.main.anchor, 5);
  assert.equal(undoDepth(restored.state), 1);
  restored.state = restored.state.update({
    effects: restored.compartments.editable.reconfigure(ideEditorEditable(false)),
  }).state;
  const dispatch = (transaction: Transaction) => {
    restored.state = transaction.state;
  };
  assert.equal(undo({ state: restored.state, dispatch }), true);
  assert.equal(restored.bom + restored.state.sliceDoc(), source.draftContent);
  assert.equal(redo({ state: restored.state, dispatch }), true);
  assert.equal(restored.bom + restored.state.sliceDoc(), "\ufeffnew one\r\ntwo\r\n");
  assert.equal(createIdeEditorSession(tab(2, "other"), false, false).state.readOnly, false);
});

test("切到另一个文件后，迟到语言结果只属于原会话", async () => {
  const first = createIdeEditorSession(tab(1, "const a = 1"), false, false);
  const second = createIdeEditorSession(tab(2, "const b = 2"), false, false);
  let resolve!: (value: Extension | null) => void;
  const delayed = new Promise<Extension | null>((done) => {
    resolve = done;
  });
  let firstNotifications = 0;
  let secondNotifications = 0;
  first.onLanguageSettled = () => {
    firstNotifications++;
  };
  second.onLanguageSettled = () => {
    secondNotifications++;
  };
  const loading = loadIdeEditorSessionLanguage(first, () => delayed);
  // 切走时释放旧激活者；语言 Promise 不捕获其他文件的活动 View。
  first.onLanguageSettled = undefined;
  const extension: Extension = [];
  resolve(extension);
  await loading;
  assert.equal(first.languageStatus, "ready");
  assert.equal(first.language, extension);
  assert.equal(firstNotifications, 0);
  assert.equal(secondNotifications, 0);
  assert.equal(second.languageStatus, "pending");
  assert.equal(second.language, null);
});

test("预览卸载再恢复后只通知新的激活者，加载失败保持显式失败状态", async () => {
  const session = createIdeEditorSession(tab(1, "const a = 1"), false, false);
  let reject!: (reason: Error) => void;
  const delayed = new Promise<Extension | null>((_resolve, fail) => {
    reject = fail;
  });
  let oldNotifications = 0;
  let currentNotifications = 0;
  session.onLanguageSettled = () => {
    oldNotifications++;
  };
  const loading = loadIdeEditorSessionLanguage(session, () => delayed);
  session.onLanguageSettled = undefined;
  session.onLanguageSettled = () => {
    currentNotifications++;
  };
  reject(new Error("chunk unavailable"));
  await loading;
  assert.equal(session.languageStatus, "failed");
  assert.equal(session.language, null);
  assert.equal(oldNotifications, 0);
  assert.equal(currentNotifications, 1);
});

test("语言加载成功但实际应用失败时清理扩展并通知一次纯文本降级", async () => {
  const session = createIdeEditorSession(tab(1, "const a = 1"), false, false);
  const incompatible = StateField.define({
    create(): number {
      throw new Error("language extension failed to initialize");
    },
    update(value) {
      return value;
    },
  });
  const notifications: string[] = [];
  session.onLanguageSettled = () => {
    notifications.push(session.languageStatus);
    // 使用真实 EditorState 扩展安装失败，验证错误来自最终应用阶段。
    session.state = session.state.update({
      effects: session.compartments.language.reconfigure(session.language ?? []),
    }).state;
  };
  await loadIdeEditorSessionLanguage(session, async () => incompatible);
  assert.deepEqual(notifications, ["ready", "failed"]);
  assert.equal(session.languageStatus, "failed");
  assert.equal(session.language, null);
  assert.deepEqual(session.compartments.language.get(session.state), []);
  assert.equal(session.state.sliceDoc(), "const a = 1");
});

test("失败通知自身的异常继续向调用方传播，不递归重试或静默吞掉", async () => {
  const session = createIdeEditorSession(tab(1, "const a = 1"), false, false);
  const notificationError = new Error("failure notification broke");
  const notifications: string[] = [];
  session.onLanguageSettled = () => {
    notifications.push(session.languageStatus);
    if (session.languageStatus === "ready") throw new Error("apply failed");
    throw notificationError;
  };
  await assert.rejects(
    loadIdeEditorSessionLanguage(session, async () => []),
    (error) => error === notificationError,
  );
  assert.deepEqual(notifications, ["ready", "failed"]);
});

test("非活动期间加载完成的无效语言扩展在恢复时降级，不丢失草稿和撤销", async () => {
  const session = createIdeEditorSession(tab(1, "const a = 1"), false, false);
  session.state = session.state.update({
    changes: { from: 0, insert: "// draft\n" },
    selection: { anchor: 3 },
  }).state;
  session.content = session.state.sliceDoc();
  // 非活动会话没有激活通知，因此导入完成后尚未在 EditorState 中安装扩展。
  const incompatible = StateField.define({
    create(): number {
      throw new Error("cached language failed to initialize");
    },
    update(value) {
      return value;
    },
  });
  await loadIdeEditorSessionLanguage(session, async () => incompatible);
  assert.equal(session.languageStatus, "ready");
  session.state = restoreIdeEditorSessionLanguage(session);
  assert.equal(session.languageStatus, "failed");
  assert.equal(session.language, null);
  assert.deepEqual(session.compartments.language.get(session.state), []);
  assert.equal(session.state.sliceDoc(), "// draft\nconst a = 1");
  assert.equal(session.state.selection.main.anchor, 3);
  assert.equal(undoDepth(session.state), 1);
});

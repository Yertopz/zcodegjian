import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";
import {
  createIdeEditorStateCache,
  IDE_EDITOR_CACHE_DOCUMENT_LIMIT,
  type IdeEditorStateSnapshot,
} from "../src/ide-mode/ideEditorStateCache.js";

function snapshot(id: number, content = `file ${id}`): IdeEditorStateSnapshot {
  return {
    path: `/workspace/${id}.txt`,
    instanceId: id,
    docVersion: 1,
    content,
    state: EditorState.create({ doc: content, extensions: [history()] }),
  };
}
function tab(entry: IdeEditorStateSnapshot) {
  return { ...entry, draftContent: entry.content };
}

test("取回原始 EditorState，保留独立选区与撤销历史且活动状态退出缓存", () => {
  const cache = createIdeEditorStateCache();
  const first = snapshot(1);
  first.state = first.state.update({
    changes: { from: 0, insert: "draft " },
    selection: { anchor: 3 },
  }).state;
  first.content = first.state.sliceDoc();
  cache.put(first);
  cache.put(snapshot(2));
  const restored = cache.take(tab(first));
  assert.equal(restored?.state, first.state);
  assert.equal(restored?.state.selection.main.anchor, 3);
  assert.equal(undoDepth(restored!.state), 1);
  assert.equal(cache.take(tab(first)), undefined);
});

test("版本、实例或 store 草稿变化都不能恢复旧编辑状态", () => {
  for (const changed of [
    { docVersion: 2 },
    { instanceId: 9 },
    { draftContent: "external draft" },
  ]) {
    const cache = createIdeEditorStateCache();
    const entry = snapshot(1);
    cache.put(entry);
    cache.prune([{ ...tab(entry), ...changed }]);
    assert.equal(cache.take({ ...tab(entry), ...changed }), undefined);
    assert.equal(cache.take(tab(entry)), undefined);
  }
});

test("最多保留四份非活动状态，淘汰不修改 store 的草稿", () => {
  const cache = createIdeEditorStateCache();
  const entries = Array.from({ length: 5 }, (_, index) => snapshot(index));
  for (const entry of entries) cache.put(entry);
  assert.equal(cache.take(tab(entries[0]!)), undefined);
  assert.equal(entries[0]!.content, "file 0");
  for (const entry of entries.slice(1)) assert.equal(cache.take(tab(entry)), entry);
});

test("最近使用状态优先保留，关闭与退出释放引用", () => {
  const cache = createIdeEditorStateCache();
  const entries = Array.from({ length: 5 }, (_, index) => snapshot(index));
  for (const entry of entries.slice(0, 4)) cache.put(entry);
  const visited = cache.take(tab(entries[0]!))!;
  cache.put(visited);
  cache.put(entries[4]!);
  assert.equal(cache.take(tab(entries[1]!)), undefined);
  cache.prune([tab(entries[0]!), tab(entries[4]!)]);
  assert.equal(cache.take(tab(entries[2]!)), undefined);
  cache.clear();
  assert.equal(cache.take(tab(entries[0]!)), undefined);
  assert.equal(cache.take(tab(entries[4]!)), undefined);
});

test("文档代码单元预算也淘汰旧项，单个超预算草稿不会进入缓存", () => {
  const cache = createIdeEditorStateCache();
  const first = snapshot(1, "a".repeat(IDE_EDITOR_CACHE_DOCUMENT_LIMIT));
  const second = snapshot(2, "b");
  cache.put(first);
  cache.put(second);
  assert.equal(cache.take(tab(first)), undefined);
  assert.equal(cache.take(tab(second)), second);
  const oversized = snapshot(3, "c".repeat(IDE_EDITOR_CACHE_DOCUMENT_LIMIT + 1));
  cache.put(oversized);
  assert.equal(cache.take(tab(oversized)), undefined);
  assert.equal(oversized.content.length, IDE_EDITOR_CACHE_DOCUMENT_LIMIT + 1);
});

test("缓存精确区分 BOM 和 CRLF，不把格式不同的草稿当作同一版本", () => {
  const cache = createIdeEditorStateCache();
  const entry = snapshot(1, "\ufeffone\r\ntwo\r\n");
  entry.state = EditorState.create({
    doc: entry.content.slice(1),
    extensions: [EditorState.lineSeparator.of("\r\n")],
  });
  cache.put(entry);
  assert.equal(cache.take({ ...tab(entry), draftContent: "one\ntwo\n" }), undefined);
  cache.put(entry);
  assert.equal("\ufeff" + cache.take(tab(entry))!.state.sliceDoc(), entry.content);
});

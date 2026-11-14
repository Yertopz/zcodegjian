import assert from "node:assert/strict";
import test from "node:test";
import {
  addWorkspaceFileTreeExpandedPaths,
  areWorkspaceFileTreeRowPropsEqual,
  createWorkspaceDirectoryGitStatusLookup,
  updateWorkspaceFileTreeScrollMask,
} from "../src/workspace-file-tree/performance.js";
import type { WorkspaceFileGitStatus } from "../src/workspace-file-tree/model.js";

test("重复定位已展开祖先保留集合身份，新祖先只复制一次且不修改原集合", () => {
  const expanded = new Set(["C:\\project\\src"]);
  assert.equal(addWorkspaceFileTreeExpandedPaths(expanded, ["C:\\project\\src"]), expanded);
  assert.equal(addWorkspaceFileTreeExpandedPaths(expanded, []), expanded);
  const next = addWorkspaceFileTreeExpandedPaths(expanded, [
    "C:\\project\\src",
    "C:\\project\\src\\nested",
    "C:\\project\\src\\nested",
  ]);
  assert.notEqual(next, expanded);
  assert.deepEqual([...next], ["C:\\project\\src", "C:\\project\\src\\nested"]);
  assert.deepEqual([...expanded], ["C:\\project\\src"]);
});

test("行复用允许相等布局，但选中、Git、权限、文案、回调和布局变化必须更新", () => {
  const props = {
    row: { path: "/project/a.ts" },
    style: { height: "28px", transform: "translateY(56px)" },
    directoryGitStatuses: ["modified"],
    selected: false,
    canOpenLocalFileManager: true,
    contextMenuLabels: { open: "打开" },
    onSelect: () => {},
  };
  assert.equal(
    areWorkspaceFileTreeRowPropsEqual(props, {
      ...props,
      style: { ...props.style },
      directoryGitStatuses: [...props.directoryGitStatuses],
    }),
    true,
  );
  for (const changed of [
    { ...props, selected: true },
    { ...props, row: { path: "/project/b.ts" } },
    { ...props, directoryGitStatuses: ["deleted"] },
    { ...props, canOpenLocalFileManager: false },
    { ...props, contextMenuLabels: { open: "Open" } },
    { ...props, onSelect: () => {} },
    { ...props, style: { ...props.style, transform: "translateY(84px)" } },
  ]) {
    assert.equal(areWorkspaceFileTreeRowPropsEqual(props, changed), false);
  }
  assert.equal(areWorkspaceFileTreeRowPropsEqual(props, { ...props, newPermission: false }), false);
});

test("目录 Git 聚合按当前快照复用，选择切换不重扫，更新快照后不读旧结果", () => {
  class CountedMap extends Map<string, WorkspaceFileGitStatus> {
    scans = 0;
    override [Symbol.iterator]() {
      this.scans += 1;
      return super[Symbol.iterator]();
    }
  }
  const statuses = new CountedMap([
    ["/project/src/a.ts", "modified"],
    ["/project/src/nested/b.ts", "untracked"],
    ["/project/src-other/c.ts", "deleted"],
  ]);
  const lookup = createWorkspaceDirectoryGitStatusLookup(statuses);
  const first = lookup("/project/src");
  assert.deepEqual(first, ["modified", "untracked"]);
  assert.equal(lookup("/project/src"), first);
  assert.equal(statuses.scans, 1);
  assert.deepEqual(lookup("/project/empty"), []);
  assert.equal(statuses.scans, 2);
  const changed = createWorkspaceDirectoryGitStatusLookup(
    new Map([["/project/src/a.ts", "deleted"]]),
  );
  assert.deepEqual(changed("/project/src"), ["deleted"]);
});

test("滚动遮罩先完成几何读取再同步写样式，同一偏移不重复写", () => {
  const events: string[] = [];
  let offset = 20;
  let value = "";
  const scrollNode = {
    get scrollTop() {
      events.push("top");
      return offset;
    },
    get scrollHeight() {
      events.push("height");
      return 200;
    },
    get clientHeight() {
      events.push("client");
      return 100;
    },
  };
  const style = {
    getPropertyValue() {
      return value;
    },
    setProperty(_name: string, next: string) {
      events.push("write");
      value = next;
    },
  };
  assert.deepEqual(updateWorkspaceFileTreeScrollMask(scrollNode, style), {
    hasOverflow: true,
    showBottomMask: true,
  });
  assert.deepEqual(events, ["top", "height", "client", "write"]);
  events.length = 0;
  updateWorkspaceFileTreeScrollMask(scrollNode, style);
  assert.deepEqual(events, ["top", "height", "client"]);
  offset = 100;
  assert.deepEqual(updateWorkspaceFileTreeScrollMask(scrollNode, style), {
    hasOverflow: true,
    showBottomMask: false,
  });
  assert.equal(value, "100px");
});

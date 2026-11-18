import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenWorkspaceFileTreeRows,
  getWorkspaceFileAncestorDirectories,
  type WorkspaceFileTreeNode,
} from "../src/workspace-file-tree/model.js";
import { addWorkspaceFileTreeExpandedPaths } from "../src/workspace-file-tree/performance.js";

test("Windows 聊天路径正斜杠定位使用原工作区目录 key，并真正展开子文件", () => {
  const root = "C:\\project";
  const directory = root + "\\nested";
  const file = directory + "\\linked.ts";
  const ancestors = getWorkspaceFileAncestorDirectories(root, "C:/project/nested/linked.ts");
  const expandedPaths = addWorkspaceFileTreeExpandedPaths(new Set<string>(), ancestors);
  const rows = flattenWorkspaceFileTreeRows({
    rootPath: root,
    childrenByDirectory: new Map<string, WorkspaceFileTreeNode[]>([
      [root, [{ path: directory, name: "nested", type: "directory" as const, depth: 1 }]],
      [directory, [{ path: file, name: "linked.ts", type: "file" as const, depth: 2 }]],
    ]),
    expandedPaths,
    loadedDirectoryPaths: new Set([root, directory]),
    loadingDirectoryPaths: new Set(),
    errorByDirectory: new Map(),
  });
  assert.ok(rows.some((row) => row.path === file));
  assert.equal(rows.find((row) => row.path === directory)?.expanded, true);
  assert.equal(
    addWorkspaceFileTreeExpandedPaths(
      expandedPaths,
      getWorkspaceFileAncestorDirectories(root, "C:/project/nested/another.ts"),
    ),
    expandedPaths,
  );
  assert.deepEqual(getWorkspaceFileAncestorDirectories("/project", "/project/nested/file.ts"), [
    "/project/nested",
  ]);
});

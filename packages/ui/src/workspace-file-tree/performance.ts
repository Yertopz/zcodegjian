import type { CSSProperties } from "react";
import { getWorkspaceDirectoryGitStatuses, type WorkspaceFileGitStatus } from "./model.js";

export const WORKSPACE_FILE_TREE_MASK_OFFSET_PROPERTY = "--workspace-file-tree-mask-offset";

/** 已展开祖先无需产生新快照，否则切换文件也会重新 flatten 整棵展开树。 */
export function addWorkspaceFileTreeExpandedPaths(current: Set<string>, paths: readonly string[]) {
  let next = current;
  for (const path of paths) {
    if (next.has(path)) continue;
    if (next === current) next = new Set(current);
    next.add(path);
  }
  return next;
}

type ComparableRowProps = {
  style: CSSProperties;
  directoryGitStatuses: readonly string[];
};

function shallowEqualObject(left: object, right: object) {
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}

/** 布局对象和状态数组可按值复用，其余所有属性（包括回调、权限与文案）仍按身份比较。 */
export function areWorkspaceFileTreeRowPropsEqual<
  T extends ComparableRowProps,
  U extends ComparableRowProps,
>(previous: T, next: U): boolean {
  const {
    style: previousStyle,
    directoryGitStatuses: previousStatuses,
    ...previousRest
  } = previous;
  const { style: nextStyle, directoryGitStatuses: nextStatuses, ...nextRest } = next;
  return (
    shallowEqualObject(previousRest, nextRest) &&
    shallowEqualObject(previousStyle, nextStyle) &&
    previousStatuses.length === nextStatuses.length &&
    previousStatuses.every((status, index) => status === nextStatuses[index])
  );
}

/** 缓存只属于调用方的当前 Git 快照；快照替换时一起丢弃，选择文件不再逐目录重扫。 */
export function createWorkspaceDirectoryGitStatusLookup(
  statuses: ReadonlyMap<string, WorkspaceFileGitStatus>,
) {
  const cache = new Map<string, WorkspaceFileGitStatus[]>();
  return (path: string): WorkspaceFileGitStatus[] => {
    const key = path.replace(/\\/g, "/").replace(/\/+$/, "");
    let result = cache.get(key);
    if (!result) {
      result = getWorkspaceDirectoryGitStatuses(statuses, path);
      cache.set(key, result);
    }
    return result;
  };
}

export function updateWorkspaceFileTreeScrollMask(
  scrollNode: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  style: Pick<CSSStyleDeclaration, "getPropertyValue" | "setProperty"> | undefined,
) {
  // 操作期采样命中此回调：先集中读取几何，避免写遮罩后再读取布局造成同步刷新。
  const { scrollTop, scrollHeight, clientHeight } = scrollNode;
  const hasOverflow = scrollHeight > clientHeight + 1;
  const showBottomMask = hasOverflow && scrollTop + clientHeight < scrollHeight - 1;
  const offset = `${scrollTop}px`;
  // 直接同步写入保留吸顶遮罩与滚动的位置一致；重复测量不再写相同值。
  if (style && style.getPropertyValue(WORKSPACE_FILE_TREE_MASK_OFFSET_PROPERTY) !== offset) {
    style.setProperty(WORKSPACE_FILE_TREE_MASK_OFFSET_PROPERTY, offset);
  }
  return { hasOverflow, showBottomMask };
}

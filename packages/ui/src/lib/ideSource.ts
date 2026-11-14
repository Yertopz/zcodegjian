import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { isAbsoluteFilePath, joinFilePath } from "./path.js";
import type { CodeViewerWorkspaceScope } from "@/lib/codeViewerWorkspaceScope.js";

export function scopeIdeSource(
  source: CodeViewerSource,
  fallback: CodeViewerWorkspaceScope,
): CodeViewerSource {
  // 显式来源必须保留；远端相同路径不能借用当前本地工作区的服务。
  const scope = source.workspacePath ? source : { ...fallback, ...source };
  const path =
    source.path && scope.workspacePath && !isAbsoluteFilePath(source.path)
      ? joinFilePath(scope.workspacePath, source.path)
      : source.path;
  return { ...scope, ...(path ? { path: path.replaceAll("\\", "/") } : {}) } as CodeViewerSource;
}
export function ideFileKey(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}
export function isEditableIdeSource(source: CodeViewerSource): boolean {
  return (
    (source.type === "file" || source.type === "code-review" || source.type === "text") &&
    Boolean(source.path) &&
    !/\.(?:png|jpe?g|gif|webp|ico|bmp|avif|pdf|pptx|mp4|webm|mp3|wav|ogg|mov)$/i.test(source.path!)
  );
}

import type { V4ConversationFileChangesResult } from "@zcode/shared/zcode-protocol-v4";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { CodeViewerWorkspaceScope } from "@/lib/codeViewerWorkspaceScope.js";

export function buildChangeSummaryFilePreviewSource(
  input: {
    path: string;
    relativePath: string;
    workspacePath: string;
  } & CodeViewerWorkspaceScope,
): CodeViewerSource {
  const { path, relativePath, workspacePath, workspaceIdentity, workspaceRemoteSessionId } = input;
  return {
    type: "file",
    title: relativePath,
    path,
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(workspaceRemoteSessionId ? { workspaceRemoteSessionId } : {}),
  };
}

export function formatChangeSummaryPatch(
  path: string,
  patches: V4ConversationFileChangesResult["items"][number]["patches"],
): string {
  if (patches.length === 0) return "";
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const patch of patches) {
    lines.push(
      `@@ -${patch.oldStart},${patch.oldLines} +${patch.newStart},${patch.newLines} @@`,
      ...patch.lines,
    );
  }
  return lines.join("\n");
}

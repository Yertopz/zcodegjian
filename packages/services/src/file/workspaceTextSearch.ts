import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { unpackWorkspaceFileEntries } from "@zcode/shared/workspaceFileEntriesCodec";
import { readTextFileForEdit } from "./textFileEditing.js";
import type {
  WorkspaceTextSearchParams,
  WorkspaceTextSearchResult,
  WorkspaceTextSearchTarget,
} from "./file.js";

const MAX_RESULTS = 200;
const MAX_QUERY = 512;
const MAX_FILES = 50_000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DURATION_MS = 30_000;
const INDEX_CHUNK_CHARS = 128_000;
const PREVIEW_BEFORE = 80;
const PREVIEW_AFTER = 160;

function validateTarget(params: WorkspaceTextSearchTarget) {
  if (
    typeof params.rootPath !== "string" ||
    !isAbsolute(params.rootPath) ||
    typeof params.requestId !== "string" ||
    !params.requestId ||
    params.requestId.length > 128 ||
    (params.workspaceIdentity !== undefined && typeof params.workspaceIdentity !== "string")
  )
    throw Error("workspace_text_search_invalid_request");
}
function sameTarget(a: WorkspaceTextSearchTarget, b: WorkspaceTextSearchTarget) {
  return (
    a.rootPath === b.rootPath &&
    (a.workspaceIdentity?.trim() || a.rootPath) === (b.workspaceIdentity?.trim() || b.rootPath)
  );
}
function skippable(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(code ?? "") ||
    (error instanceof Error && error.message.startsWith("file_edit_"))
  );
}

/** 在途句柄归 FileService；共享文件索引不随单个搜索取消，正文读取按请求检查取消。 */
export function createWorkspaceTextSearch(
  getIndex: (params: WorkspaceTextSearchParams) => Promise<string>,
): {
  searchWorkspaceText(params: WorkspaceTextSearchParams): Promise<WorkspaceTextSearchResult>;
  cancelWorkspaceTextSearch(params: WorkspaceTextSearchTarget): Promise<boolean>;
} {
  const active = new Map<
    string,
    { target: WorkspaceTextSearchTarget; controller: AbortController }
  >();
  return {
    async cancelWorkspaceTextSearch(params) {
      validateTarget(params);
      const request = active.get(params.requestId);
      if (!request || !sameTarget(request.target, params)) return false;
      request.controller.abort();
      return true;
    },
    async searchWorkspaceText(params) {
      validateTarget(params);
      if (
        typeof params.query !== "string" ||
        params.query.length > MAX_QUERY ||
        /[\r\n]/.test(params.query) ||
        (params.caseSensitive !== undefined && typeof params.caseSensitive !== "boolean") ||
        (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1))
      )
        throw Error("workspace_text_search_invalid_request");
      const result: WorkspaceTextSearchResult = {
        matches: [],
        searchedFiles: 0,
        skippedFiles: 0,
        truncated: false,
        cancelled: false,
      };
      if (!params.query) return result;
      if (active.has(params.requestId)) throw Error("workspace_text_search_duplicate_request");
      const controller = new AbortController();
      active.set(params.requestId, { target: { ...params }, controller });
      try {
        // 必须在第一个 await 前登记，切换工作区/关闭搜索时才能取消仍在等待索引的请求。
        const packed = await getIndex(params);
        if (controller.signal.aborted) return { ...result, cancelled: true };
        const root = await realpath(params.rootPath);
        if (!(await stat(root)).isDirectory()) throw Error("workspace_text_search_invalid_root");
        const limit = Math.min(MAX_RESULTS, params.limit ?? MAX_RESULTS);
        const expression = new RegExp(
          params.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          params.caseSensitive ? "u" : "iu",
        );
        let readBytes = 0;
        let fileCount = 0;
        const startedAt = Date.now();
        search: for (let offset = 0; offset < packed.length; ) {
          const newline = packed.indexOf("\n", offset + INDEX_CHUNK_CHARS);
          const end = newline < 0 ? packed.length : newline + 1;
          const entries = unpackWorkspaceFileEntries(packed.slice(offset, end), params.rootPath);
          offset = end;
          for (const entry of entries) {
            if (controller.signal.aborted) break search;
            if (entry.type !== "file") continue;
            if (
              fileCount >= MAX_FILES ||
              readBytes >= MAX_BYTES ||
              Date.now() - startedAt >= MAX_DURATION_MS
            ) {
              result.truncated = true;
              break search;
            }
            fileCount++;
            let content: string;
            try {
              const actual = await realpath(entry.path);
              const within = relative(root, actual);
              if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
                result.skippedFiles++;
                continue;
              }
              // 不读任意候选路径：先核对真实路径围栏，再用既有严格读取拒绝符号链接/二进制。
              content = (await readTextFileForEdit({ path: entry.path })).content;
            } catch (error) {
              if (!skippable(error)) throw error;
              result.skippedFiles++;
              continue;
            }
            if (controller.signal.aborted) break search;
            readBytes += Buffer.byteLength(content, "utf8");
            if (readBytes > MAX_BYTES) {
              result.truncated = true;
              break search;
            }
            result.searchedFiles++;
            // 编辑器隐藏 UTF-8 BOM，列号须采用同一坐标；兼容 CRLF、LF 和 CR。
            const lines = content.replace(/^\ufeff/, "").split(/\r\n|\r|\n/);
            for (let index = 0; index < lines.length; index++) {
              const line = lines[index]!;
              const match = expression.exec(line);
              if (!match) continue;
              const start = Math.max(0, match.index - PREVIEW_BEFORE);
              result.matches.push({
                path: entry.path,
                relativePath: entry.relativePath,
                lineNumber: index + 1,
                columnNumber: match.index + 1,
                preview: line.slice(start, match.index + match[0].length + PREVIEW_AFTER),
                matchStart: match.index - start,
                matchLength: match[0].length,
              });
              if (result.matches.length >= limit) {
                result.truncated = true;
                break search;
              }
            }
          }
          await setImmediate();
        }
        return { ...result, cancelled: controller.signal.aborted };
      } finally {
        active.delete(params.requestId);
      }
    },
  };
}

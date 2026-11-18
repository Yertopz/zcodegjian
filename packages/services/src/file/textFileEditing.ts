import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { atomicWriteText, withAtomicFileLock } from "../fs/atomicFileUtils.js";

export const MAX_EDIT_TEXT_BYTES = 256 * 1024;

function metadata(info: BigIntStats): string {
  return [info.dev, info.ino, info.size, info.mode, info.mtimeNs, info.ctimeNs].join(":");
}

function validateFile(info: BigIntStats): void {
  if (info.isSymbolicLink()) throw new Error("file_edit_symlink");
  if (!info.isFile()) throw new Error("file_edit_not_a_file");
  if (info.size > BigInt(MAX_EDIT_TEXT_BYTES)) throw new Error("file_edit_too_large");
}

function decodeText(bytes: Buffer): string {
  if (bytes.byteLength > MAX_EDIT_TEXT_BYTES) throw new Error("file_edit_too_large");
  // 与文本预览一致地拒绝 NUL/控制字符；严格解码防止保存时把坏字节替换成 U+FFFD。
  let controls = 0;
  for (const byte of bytes) {
    if (byte === 0) throw new Error("file_edit_binary");
    if ((byte < 32 && ![9, 10, 12, 13].includes(byte)) || byte === 127) controls++;
  }
  if (controls > bytes.length * 0.1) throw new Error("file_edit_binary");
  try {
    // ignoreBOM=true 表示保留 BOM 字符，避免无意改变文件原始编码标记。
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("file_edit_invalid_utf8");
  }
}

async function snapshot(path: string) {
  try {
    const namedBefore = await lstat(path, { bigint: true });
    validateFile(namedBefore);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat({ bigint: true });
      validateFile(before);
      if (metadata(before) !== metadata(namedBefore)) throw new Error("file_edit_read_conflict");
      // 最多读取上限+1；不能用无界 readFile，因为外部进程可在 stat 后扩大文件。
      const buffer = Buffer.alloc(MAX_EDIT_TEXT_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      const namedAfter = await lstat(path, { bigint: true });
      validateFile(namedAfter);
      if (
        metadata(before) !== metadata(after) ||
        metadata(after) !== metadata(namedAfter) ||
        BigInt(total) !== after.size
      ) {
        throw new Error("file_edit_read_conflict");
      }
      const bytes = buffer.subarray(0, total);
      const content = decodeText(bytes);
      const version = createHash("sha256")
        .update(metadata(after))
        .update("\0")
        .update(bytes)
        .digest("hex");
      return { content, version, mode: Number(after.mode & 0o7777n) };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("file_edit_not_found");
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new Error("file_edit_symlink");
    throw error;
  }
}

export async function readTextFileForEdit({ path }: { path: string }) {
  const { content, version } = await snapshot(path);
  return { content, version };
}

export async function writeEditableTextFile(params: {
  path: string;
  content: string;
  expectedVersion: string;
}): Promise<{ version: string }> {
  if (
    typeof params.expectedVersion !== "string" ||
    !/^[a-f0-9]{64}$/.test(params.expectedVersion)
  ) {
    throw new Error("file_write_version_required");
  }
  // 先按字节计量，避免超大粘贴先分配同等大小的 Buffer 才触发上限。
  if (Buffer.byteLength(params.content, "utf8") > MAX_EDIT_TEXT_BYTES)
    throw new Error("file_edit_too_large");
  const bytes = Buffer.from(params.content, "utf8");
  if (decodeText(bytes) !== params.content) throw new Error("file_edit_invalid_utf8");
  // 先拒绝链接，再规范化锁路径，防止路径别名绕过同目标的锁。
  await snapshot(params.path);
  const lockPath = await realpath(params.path);
  return withAtomicFileLock(lockPath, async () => {
    const current = await snapshot(params.path);
    if (current.version !== params.expectedVersion) throw new Error("file_write_conflict");
    await atomicWriteText(params.path, params.content, {
      useFileLock: false,
      mode: current.mode,
      validateBeforeRename: async () => {
        const latest = await snapshot(params.path);
        if (latest.version !== params.expectedVersion) throw new Error("file_write_conflict");
      },
    });
    const written = await snapshot(params.path);
    if (written.content !== params.content) throw new Error("file_write_conflict");
    return { version: written.version };
  });
}

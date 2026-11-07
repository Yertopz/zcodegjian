import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, realpath, rename, rm, link } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createHash } from "node:crypto";
import type { SFTPWrapper, Stats } from "ssh2";
import type { ServerFile, ServerTransfer } from "@zcode/shared";

const remoteStat = (sftp: SFTPWrapper, path: string) =>
  new Promise<Stats>((yes, no) => sftp.lstat(path, (e, s) => (e ? no(e) : yes(s))));
const remoteRename = (sftp: SFTPWrapper, source: string, target: string, overwrite: boolean) =>
  new Promise<void>((yes, no) => {
    const cb = (e?: Error | null) => (e ? no(e) : yes());
    if (overwrite) sftp.ext_openssh_rename(source, target, cb);
    else sftp.rename(source, target, cb);
  });
const missing = (error: unknown) =>
  [2, "ENOENT"].includes((error as { code?: number | string })?.code ?? "");
export interface TransferCheckpoint {
  size: number;
  modified: number;
  completed: boolean;
  sha256?: string;
}

export async function listServerFiles(
  sftp: SFTPWrapper | undefined,
  path: string,
): Promise<{ files: ServerFile[]; path: string; truncated: boolean }> {
  if (!sftp) {
    const resolved = await realpath(path || process.env.USERPROFILE || process.env.HOME || ".");
    const entries = await readdir(resolved, { withFileTypes: true });
    const files = await Promise.all(
      entries.slice(0, 2000).map(async (entry) => {
        const p = join(resolved, entry.name),
          info = await lstat(p).catch(() => null);
        return {
          name: entry.name,
          path: p,
          directory: entry.isDirectory(),
          size: info?.size ?? 0,
          modified: info?.mtimeMs ?? 0,
        };
      }),
    );
    return { path: resolved, files, truncated: entries.length > 2000 };
  }
  const resolved = await new Promise<string>((yes, no) =>
    sftp.realpath(path || ".", (e, p) => (e ? no(e) : yes(p))),
  );
  const handle = await new Promise<Buffer>((yes, no) =>
    sftp.opendir(resolved, (e, h) => (e ? no(e) : yes(h))),
  );
  const entries: import("ssh2").FileEntryWithStats[] = [];
  try {
    // 按协议包读取并在预算处关闭 handle，不能先无界读完目录再截断 Renderer 列表。
    while (entries.length <= 2000) {
      const page = await new Promise<import("ssh2").FileEntryWithStats[] | false>((yes, no) =>
        sftp.readdir(handle, (e, list) =>
          (e as Error & { code?: number })?.code === 1 ? yes(false) : e ? no(e) : yes(list),
        ),
      );
      if (!page || !page.length) break;
      entries.push(
        ...page
          .filter((e) => e.filename !== "." && e.filename !== "..")
          .slice(0, 2001 - entries.length),
      );
    }
  } finally {
    await new Promise<void>((yes) => sftp.close(handle, () => yes()));
  }
  return {
    path: resolved,
    truncated: entries.length > 2000,
    files: entries.slice(0, 2000).map((e) => ({
      name: e.filename,
      path: posix.join(resolved, e.filename),
      directory: e.attrs.isDirectory(),
      size: e.attrs.size,
      modified: e.attrs.mtime * 1000,
    })),
  };
}

/** 文件流直达 SFTP，不进入 Renderer；临时文件属于当前任务，成功才提交最终名称。 */
export async function transferServerFiles(input: {
  sftp: SFTPWrapper;
  task: ServerTransfer;
  overwrite: boolean;
  signal: AbortSignal;
  changed: () => void;
  checkpoints?: Map<string, TransferCheckpoint>;
}): Promise<void> {
  const { sftp, task, overwrite, signal, changed } = input;
  let files = 0;
  const upload = task.direction === "upload";
  const checkpoints = input.checkpoints ?? new Map<string, TransferCheckpoint>();
  task.bytes = 0;
  task.total = 0;
  task.resumeAvailable = false;
  const digest = async (stream: NodeJS.ReadableStream, hash = createHash("sha256")) => {
    // ssh2 的 CLOSE 回执可能晚于可读 end；保留监听避免退出连接时的迟到错误成为未捕获异常。
    // 读取阶段的错误仍由 async iterator 抛出，不会把失败校验当成成功。
    stream.on("error", () => {});
    for await (const chunk of stream) {
      signal.throwIfAborted();
      hash.update(chunk as Buffer);
    }
    return hash;
  };
  const readStat = (path: string) => (upload ? lstat(path) : remoteStat(sftp, path));
  const removePart = async (path: string) => {
    if (upload) await new Promise<void>((yes) => sftp.unlink(path, () => yes()));
    else await rm(path, { force: true });
  };
  const visit = async (source: string, target: string, depth: number): Promise<void> => {
    signal.throwIfAborted();
    if (depth > 32 || ++files > 10000) throw new Error("目录传输超过深度或文件数量限制");
    const info = await readStat(source);
    if (info.isSymbolicLink()) throw new Error("目录传输不跟随符号链接，请单独选择真实路径");
    if (info.isDirectory()) {
      if (upload) {
        await new Promise<void>((yes, no) =>
          sftp.mkdir(target, (e) => {
            if (!e) return yes();
            void remoteStat(sftp, target).then(
              (s) => (s.isDirectory() ? yes() : no(e)),
              () => no(e),
            );
          }),
        );
      } else await mkdir(target, { recursive: true });
      const listing = upload ? undefined : await listServerFiles(sftp, source);
      if (listing?.truncated) throw new Error("目录过大，不能截断目录传输；请分批选择子目录");
      const children = upload
        ? (await readdir(source)).map((name) => ({
            name,
            source: join(source, name),
            target: posix.join(target, name),
          }))
        : listing!.files.map((f) => ({
            name: f.name,
            source: f.path,
            target: join(target, f.name),
          }));
      for (const child of children) {
        // SFTP 返回的文件名不能逃出用户选择的本地目标目录。
        if (
          [".", ".."].includes(child.name) ||
          /[\\/]/.test(child.name) ||
          child.name.includes("\0") ||
          (!upload && process.platform === "win32" && /[:<>"|?*]/.test(child.name)) ||
          (!upload && resolve(child.target) !== resolve(target, child.name))
        )
          throw new Error("服务器返回非法文件名");
        await visit(child.source, child.target, depth + 1);
      }
      return;
    }
    const modified = (s: typeof info) => ("mtimeMs" in s ? s.mtimeMs : s.mtime);
    const previous = checkpoints.get(source);
    if (previous && (previous.size !== info.size || previous.modified !== modified(info)))
      throw new Error("源文件已改变，不能继续旧传输，请重新创建任务");
    const checkpoint = previous ?? { size: info.size, modified: modified(info), completed: false };
    checkpoints.set(source, checkpoint);
    task.total += info.size;
    const destinationInfo = await (upload ? remoteStat(sftp, target) : lstat(target)).catch((e) => {
      if (missing(e)) return null;
      throw e;
    });
    if (destinationInfo?.isSymbolicLink()) throw new Error("目标是符号链接，请选择真实目标路径");
    if (checkpoint.completed) {
      if (!destinationInfo || destinationInfo.size !== info.size)
        throw new Error("已传输文件的目标已改变，请重新创建任务");
      const targetHash = await digest(
        upload ? sftp.createReadStream(target) : createReadStream(target),
      );
      if (targetHash.digest("hex") !== checkpoint.sha256) throw new Error("已传输目标校验不一致");
      task.bytes += info.size;
      changed();
      return;
    }
    if (destinationInfo && !overwrite)
      throw new Error(`目标已存在：${basename(target)}，请确认覆盖或另存为`);
    const part = `${target}.zcode-${task.id}.part`;
    const partInfo = await (upload ? remoteStat(sftp, part) : lstat(part)).catch((e) => {
      if (missing(e)) return null;
      throw e;
    });
    if (partInfo && (!partInfo.isFile() || !previous))
      throw new Error("临时文件不属于可恢复的任务");
    const start = partInfo?.size ?? 0;
    if (start > info.size) throw new Error("临时文件长度异常，不能续传");
    let hash = createHash("sha256");
    if (start > 0) {
      hash = await digest(
        upload
          ? createReadStream(source, { start: 0, end: start - 1 })
          : sftp.createReadStream(source, { start: 0, end: start - 1 }),
      );
      const partialHash = await digest(
        upload ? sftp.createReadStream(part) : createReadStream(part),
      );
      if (hash.copy().digest("hex") !== partialHash.digest("hex"))
        throw new Error("临时文件与源文件前缀不一致，拒绝续传");
    }
    task.bytes += start;
    changed();
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        task.bytes += chunk.length;
        changed();
        callback(null, chunk);
      },
    });
    try {
      if (!upload) await mkdir(dirname(target), { recursive: true });
      if (start < info.size || !partInfo) {
        const sourceStream = upload
          ? createReadStream(source, { start })
          : sftp.createReadStream(source, { start });
        const targetStream = upload
          ? sftp.createWriteStream(part, { flags: partInfo ? "r+" : "wx", start })
          : createWriteStream(part, { flags: partInfo ? "r+" : "wx", start });
        await pipeline(sourceStream, meter, targetStream, { signal });
      }
      const after = await readStat(source);
      if (after.size !== info.size || modified(after) !== modified(info))
        throw new Error("传输期间源文件发生变化，请重试");
      signal.throwIfAborted();
      const expected = hash.digest("hex");
      const verified = await digest(upload ? sftp.createReadStream(part) : createReadStream(part));
      if (verified.digest("hex") !== expected) throw new Error("SHA-256 校验失败，未提交目标文件");
      if (upload) {
        const now = await remoteStat(sftp, target).catch((e) => {
          if (missing(e)) return null;
          throw e;
        });
        if (
          Boolean(now) !== Boolean(destinationInfo) ||
          (now &&
            destinationInfo &&
            (now.size !== destinationInfo.size ||
              now.mtime !== (destinationInfo as Stats).mtime ||
              now.isSymbolicLink()))
        )
          throw new Error("目标在传输期间发生变化");
        await remoteRename(sftp, part, target, Boolean(destinationInfo && overwrite));
      } else {
        // 不覆盖新出现的文件；已确认覆盖的目标仍须保持创建任务时的版本。
        const now = await lstat(target).catch((e) => {
          if (missing(e)) return null;
          throw e;
        });
        if (
          Boolean(now) !== Boolean(destinationInfo) ||
          (now &&
            destinationInfo &&
            (now.size !== destinationInfo.size ||
              now.mtimeMs !== (destinationInfo as import("node:fs").Stats).mtimeMs))
        )
          throw new Error("目标在传输期间发生变化");
        if (destinationInfo) await rename(part, target);
        else {
          // hard link 是排他的最终提交，避免 stat→rename 之间新出现的用户文件被覆盖。
          await link(part, target);
          await rm(part);
        }
      }
      checkpoint.completed = true;
      checkpoint.sha256 = expected;
      task.sha256 = expected;
    } catch (error) {
      if (signal.aborted && (signal.reason as Error)?.message === "user-cancel") {
        await removePart(part).catch(() => {});
        checkpoints.delete(source);
      } else task.resumeAvailable = true;
      throw error;
    }
  };
  await visit(task.source, task.destination, 0);
}

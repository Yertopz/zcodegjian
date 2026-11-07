import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, posix } from "node:path";
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import ssh2 from "ssh2";
import { transferServerFiles, listServerFiles } from "../src/host/serverWorkbench/fileTransport.ts";

// 仅绑定回环接口，SFTP 最终读写临时目录。预算 12 MiB，无用户凭据，finally 全部回收。
test(
  "真实 SFTP：中文目录上传/下载、冲突、SHA-256、恢复和取消清理",
  { timeout: 45000 },
  async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "zcode-sftp-test-"));
    const remoteRoot = join(root, "remote");
    await fs.mkdir(remoteRoot);
    const peers = new Set(),
      files = new Set();
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
    });
    const server = new ssh2.Server({ hostKeys: [privateKey] });
    server.on("connection", (peer) => {
      peers.add(peer);
      peer.on("error", () => {});
      peer.on("close", () => peers.delete(peer));
      peer
        .on("authentication", (c) => c.accept())
        .on("ready", () =>
          peer.on("session", (accept) =>
            accept().on("sftp", (acceptSftp) => {
              const sftp = acceptSftp(),
                handles = new Map();
              let next = 0;
              const local = (path) => {
                const p = resolve(remoteRoot, "." + posix.normalize("/" + path));
                if (!p.startsWith(remoteRoot + sep) && p !== remoteRoot)
                  throw Error("outside fixture");
                return p;
              };
              const attrs = (s) => ({
                mode: s.mode,
                uid: 0,
                gid: 0,
                size: s.size,
                atime: Math.floor(s.atimeMs / 1000),
                mtime: Math.floor(s.mtimeMs / 1000),
              });
              const status = (id, error) =>
                sftp.status(id, error?.code === "ENOENT" ? 2 : error ? 4 : 0);
              const on = (event, action) =>
                sftp.on(event, (id, ...args) =>
                  Promise.resolve()
                    .then(() => action(id, ...args))
                    .catch((e) => status(id, e)),
                );
              const handle = (id, value) => {
                const token = Buffer.alloc(4);
                token.writeUInt32BE(++next);
                handles.set(next, value);
                sftp.handle(id, token);
              };
              const lookup = (token) => {
                const v = handles.get(token.readUInt32BE());
                if (!v) throw Error("invalid handle");
                return v;
              };
              on("REALPATH", async (id, p) =>
                sftp.name(id, [
                  {
                    filename: posix.normalize("/" + p),
                    longname: "",
                    attrs: attrs(await fs.stat(local(p))),
                  },
                ]),
              );
              for (const op of ["LSTAT", "STAT"])
                on(op, async (id, p) => sftp.attrs(id, attrs(await fs.lstat(local(p)))));
              on("FSTAT", async (id, h) => sftp.attrs(id, attrs(await lookup(h).file.stat())));
              on("OPEN", async (id, p, flags) => {
                const file = await fs.open(local(p), ssh2.utils.sftp.flagsToString(flags));
                files.add(file);
                handle(id, { file });
              });
              on("READ", async (id, h, offset, length) => {
                const data = Buffer.alloc(length);
                const { bytesRead } = await lookup(h).file.read(data, 0, length, offset);
                if (bytesRead) sftp.data(id, data.subarray(0, bytesRead));
                else sftp.status(id, 1);
              });
              on("WRITE", async (id, h, offset, data) => {
                await lookup(h).file.write(data, 0, data.length, offset);
                status(id);
              });
              on("CLOSE", async (id, h) => {
                const v = lookup(h);
                if (v.file) {
                  await v.file.close();
                  files.delete(v.file);
                }
                handles.delete(h.readUInt32BE());
                status(id);
              });
              on("OPENDIR", async (id, p) =>
                handle(id, { path: p, entries: await fs.readdir(local(p)) }),
              );
              on("READDIR", async (id, h) => {
                const v = lookup(h);
                if (!v.entries.length) return sftp.status(id, 1);
                const entries = v.entries.splice(0, 40);
                sftp.name(
                  id,
                  await Promise.all(
                    entries.map(async (name) => ({
                      filename: name,
                      longname: name,
                      attrs: attrs(await fs.lstat(local(posix.join(v.path, name)))),
                    })),
                  ),
                );
              });
              on("MKDIR", async (id, p) => {
                await fs.mkdir(local(p));
                status(id);
              });
              on("REMOVE", async (id, p) => {
                await fs.unlink(local(p));
                status(id);
              });
              on("RENAME", async (id, a, b) => {
                await fs.link(local(a), local(b));
                await fs.unlink(local(a));
                status(id);
              });
              on("EXTENDED", async (id, name, a, b) => {
                if (name !== "posix-rename@openssh.com") return sftp.status(id, 8);
                await fs.rename(local(a), local(b));
                status(id);
              });
            }),
          ),
        );
    });
    const client = new ssh2.Client();
    client.on("error", () => {});
    try {
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      await new Promise((yes, no) =>
        client
          .once("ready", yes)
          .once("error", no)
          .connect({
            host: "127.0.0.1",
            port: server.address().port,
            username: "test",
            password: "fixture-only",
            hostVerifier: () => true,
          }),
      );
      const sftp = await new Promise((yes, no) => client.sftp((e, s) => (e ? no(e) : yes(s))));
      const source = join(root, "中文 source");
      await fs.mkdir(source);
      const payload = Buffer.alloc(256 * 1024, "abc中文");
      await fs.writeFile(join(source, "文件.bin"), payload);
      const make = (direction, src, dst, id = randomUUID()) => ({
        id,
        serverId: "fixture",
        generation: 1,
        source: src,
        destination: dst,
        direction,
        state: "running",
        bytes: 0,
        total: 0,
        startedAt: Date.now(),
      });
      const run = (task, extra = {}) =>
        transferServerFiles({
          sftp,
          task,
          overwrite: false,
          signal: new AbortController().signal,
          changed: () => {},
          ...extra,
        });
      const uploaded = make("upload", source, "/上传");
      await run(uploaded);
      assert.deepEqual(await fs.readFile(join(remoteRoot, "上传", "文件.bin")), payload);
      assert.equal(uploaded.sha256, createHash("sha256").update(payload).digest("hex"));
      const listing = await listServerFiles(sftp, "/上传");
      assert.equal(listing.files[0].name, "文件.bin");
      await assert.rejects(
        run(make("upload", join(source, "文件.bin"), "/上传/文件.bin")),
        /目标已存在/,
      );
      const download = make("download", "/上传", join(root, "下载"));
      await run(download);
      assert.deepEqual(await fs.readFile(join(root, "下载", "文件.bin")), payload);
      const checkpoint = new Map(),
        interrupted = make("upload", join(source, "文件.bin"), "/resume.bin"),
        abort = new AbortController();
      await assert.rejects(
        run(interrupted, {
          checkpoints: checkpoint,
          signal: abort.signal,
          changed: () => {
            if (interrupted.bytes > 0) abort.abort(new Error("network-loss"));
          },
        }),
      );
      assert.equal(interrupted.resumeAvailable, true);
      await run(interrupted, { checkpoints: checkpoint });
      assert.deepEqual(await fs.readFile(join(remoteRoot, "resume.bin")), payload);
      const cancelled = make("download", "/上传/文件.bin", join(root, "cancelled.bin")),
        stop = new AbortController();
      await assert.rejects(
        run(cancelled, {
          signal: stop.signal,
          changed: () => {
            if (cancelled.bytes > 0) stop.abort(new Error("user-cancel"));
          },
        }),
      );
      await assert.rejects(fs.access(cancelled.destination + ".zcode-" + cancelled.id + ".part"));
      const bad = make("upload", join(source, "文件.bin"), "/bad.bin"),
        badCheckpoints = new Map([
          [
            join(source, "文件.bin"),
            {
              size: payload.length,
              modified: (await fs.stat(join(source, "文件.bin"))).mtimeMs,
              completed: false,
            },
          ],
        ]);
      await fs.writeFile(join(remoteRoot, "bad.bin.zcode-" + bad.id + ".part"), "wrong prefix");
      await assert.rejects(run(bad, { checkpoints: badCheckpoints }), /前缀不一致/);
    } finally {
      client.destroy();
      for (const peer of peers) peer.end();
      await new Promise((r) => server.close(r));
      for (const file of files) await file.close().catch(() => {});
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

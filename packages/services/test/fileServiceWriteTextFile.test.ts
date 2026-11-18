import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createFileService } from "../src/file/fileService.js";
import { createFsFaultInjector, setFsFaultInjectorForTests } from "../src/fs/fsFaultInjection.js";

// 每个用例只操作自身临时目录，验证最终磁盘内容而非仅检查服务返回值。
async function fixture(run: (path: string, dir: string) => Promise<void>) {
  const base = resolve(tmpdir());
  const dir = await mkdtemp(join(base, "zcode-ide-file-test-"));
  try {
    const path = join(dir, "sample.ts");
    await writeFile(path, "original\n");
    await run(path, dir);
  } finally {
    assert.equal(dirname(resolve(dir)), base);
    await rm(dir, { recursive: true, force: true });
  }
}

test("编辑快照与保存：版本推进，BOM/CRLF 和空文件按原始字节往返", async () => {
  await fixture(async (path) => {
    const service = createFileService();
    for (const content of ["\ufeffhello\r\nworld\r\n", "", "中文\n"]) {
      await writeFile(path, content);
      const snapshot = await service.readTextFileForEdit({ path });
      assert.equal(snapshot.content, content);
      assert.match(snapshot.version, /^[a-f0-9]{64}$/);
      const result = await service.writeTextFile({
        path,
        content: content + "saved",
        expectedVersion: snapshot.version,
      });
      assert.equal(await readFile(path, "utf8"), content + "saved");
      assert.equal((await service.readTextFileForEdit({ path })).version, result.version);
      assert.notEqual(result.version, snapshot.version);
    }
  });
});

test("同版本并发写入仅一个成功，失败者不能覆盖成功者", async () => {
  await fixture(async (path) => {
    const first = createFileService();
    const second = createFileService();
    const { version } = await first.readTextFileForEdit({ path });
    const results = await Promise.allSettled([
      first.writeTextFile({ path, content: "writer A", expectedVersion: version }),
      second.writeTextFile({ path, content: "writer B", expectedVersion: version }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    // Windows 也可能拒绝并发创建锁目录；不能把真实权限错误伪装成版本冲突。
    // 此用例的关键判据是恰好一方成功，最终磁盘只能等于成功方提交的内容。
    assert.ok(
      /file_write_conflict/.test(rejected.reason.message) ||
        ["EPERM", "EACCES"].includes(rejected.reason.code),
      rejected.reason.message,
    );
    assert.equal(
      await readFile(path, "utf8"),
      results[0].status === "fulfilled" ? "writer A" : "writer B",
    );
  });
});

test("外部同长度同 mtime 改盘仍检测冲突，缺版本不保存", async () => {
  await fixture(async (path) => {
    const service = createFileService();
    const before = await stat(path);
    const snapshot = await service.readTextFileForEdit({ path });
    await writeFile(path, "external\n");
    await utimes(path, before.atime, before.mtime);
    await assert.rejects(
      service.writeTextFile({ path, content: "stale", expectedVersion: snapshot.version }),
      /file_write_conflict/,
    );
    await assert.rejects(
      service.writeTextFile({ path, content: "unsafe", expectedVersion: "" }),
      /file_write_version_required/,
    );
    assert.equal(await readFile(path, "utf8"), "external\n");
  });
});

test("读写按 UTF-8 字节限制，拒绝损坏编码与二进制", async () => {
  await fixture(async (path) => {
    const service = createFileService();
    const snapshot = await service.readTextFileForEdit({ path });
    await assert.rejects(
      service.writeTextFile({
        path,
        content: "汉".repeat(100000),
        expectedVersion: snapshot.version,
      }),
      /file_edit_too_large/,
    );
    assert.equal(await readFile(path, "utf8"), "original\n");
    await writeFile(path, Buffer.from([0xff, 0xfe, 0x41]));
    await assert.rejects(service.readTextFileForEdit({ path }), /file_edit_invalid_utf8/);
    await writeFile(path, Buffer.from([0, 1, 2]));
    await assert.rejects(service.readTextFileForEdit({ path }), /file_edit_binary/);
    await writeFile(path, "x".repeat(256 * 1024 + 1));
    await assert.rejects(service.readTextFileForEdit({ path }), /file_edit_too_large/);
    await writeFile(path, "x".repeat(256 * 1024));
    assert.equal((await service.readTextFileForEdit({ path })).content.length, 256 * 1024);
  });
});

test("目标消失或为目录时拒绝，不创建新文件", async () => {
  await fixture(async (path, dir) => {
    const service = createFileService();
    const snapshot = await service.readTextFileForEdit({ path });
    await rm(path);
    await assert.rejects(
      service.writeTextFile({ path, content: "x", expectedVersion: snapshot.version }),
      /file_edit_not_found|file_write_conflict/,
    );
    await assert.rejects(service.readTextFileForEdit({ path: dir }), /file_edit_not_a_file/);
    await assert.rejects(lstat(path), { code: "ENOENT" });
  });
});

test("替换权限失败保留原文件、清理临时文件并释放锁，可原版本重试", async () => {
  await fixture(async (path, dir) => {
    const service = createFileService();
    const { version } = await service.readTextFileForEdit({ path });
    setFsFaultInjectorForTests(
      createFsFaultInjector([
        { id: "ide-permission", code: "EACCES", operations: ["rename"], pathIncludes: path },
      ]),
    );
    try {
      await assert.rejects(
        service.writeTextFile({ path, content: "draft", expectedVersion: version }),
        { code: "EACCES" },
      );
      assert.equal(await readFile(path, "utf8"), "original\n");
      assert.deepEqual(await readdir(dir), ["sample.ts"]);
    } finally {
      setFsFaultInjectorForTests(null);
    }
    await service.writeTextFile({ path, content: "retry", expectedVersion: version });
    assert.equal(await readFile(path, "utf8"), "retry");
  });
});

test("符号链接拒绝；POSIX 权限位在原子替换后保留", async (t) => {
  await fixture(async (path, dir) => {
    const service = createFileService();
    const link = join(dir, "link.ts");
    try {
      await symlink(path, link, "file");
      await assert.rejects(service.readTextFileForEdit({ path: link }), /file_edit_symlink/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      t.diagnostic("当前 Windows 无创建文件符号链接权限，此断言未执行");
    }
    if (process.platform !== "win32") {
      await chmod(path, 0o751);
      const snapshot = await service.readTextFileForEdit({ path });
      await service.writeTextFile({
        path,
        content: "executable",
        expectedVersion: snapshot.version,
      });
      assert.equal((await stat(path)).mode & 0o777, 0o751);
    } else t.diagnostic("POSIX 执行位断言需 Linux/macOS，本机未执行");
  });
});

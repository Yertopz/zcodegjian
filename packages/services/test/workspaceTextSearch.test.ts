import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createFileService } from "../src/file/fileService.js";
import { createWorkspaceTextSearch } from "../src/file/workspaceTextSearch.js";

async function fixture(run: (rootPath: string) => Promise<void>) {
  const base = resolve(tmpdir());
  const rootPath = await mkdtemp(join(base, "zcode-text-search-"));
  try {
    await run(rootPath);
  } finally {
    assert.equal(dirname(rootPath), base);
    await rm(rootPath, { recursive: true, force: true });
  }
}

test("真实文件正文搜索：中文、BOM/CRLF 行列、大小写及正则字符按字面匹配", async () => {
  await fixture(async (rootPath) => {
    await writeFile(
      join(rootPath, "sample.txt"),
      "\ufeff第一行\r\n  中文 Needle a+b[0]\r\nneedle\n",
    );
    const service = createFileService();
    const search = (query: string, caseSensitive = false) =>
      service.searchWorkspaceText({
        rootPath,
        requestId: `test-${query}`,
        query,
        caseSensitive,
      });
    const result = await search("Needle");
    assert.deepEqual(
      result.matches.map((m) => [m.lineNumber, m.columnNumber]),
      [
        [2, 6],
        [3, 1],
      ],
    );
    assert.equal((await search("Needle", true)).matches.length, 1);
    const literal = (await search("a+b[0]")).matches[0]!;
    assert.equal(
      literal.preview.slice(literal.matchStart, literal.matchStart + literal.matchLength),
      "a+b[0]",
    );
    assert.equal((await search("中文")).matches[0]?.columnNumber, 3);
    assert.equal(result.cancelled, false);
  });
});

test("忽略规则、坏 UTF-8/二进制/超限跳过、上限标记与新文件即时可搜索", async () => {
  await fixture(async (rootPath) => {
    await mkdir(join(rootPath, "ignored"));
    await writeFile(join(rootPath, ".zcodeignore"), "ignored/\n");
    await writeFile(join(rootPath, "ignored", "secret.txt"), "needle");
    await writeFile(join(rootPath, "good.txt"), "needle\nneedle\n");
    await writeFile(join(rootPath, "binary.txt"), Buffer.from([0, 1, 2]));
    await writeFile(join(rootPath, "invalid.txt"), Buffer.from([0xff, 0xfe, 65]));
    await writeFile(join(rootPath, "large.txt"), "x".repeat(256 * 1024 + 1));
    const service = createFileService();
    const result = await service.searchWorkspaceText({
      rootPath,
      requestId: "first",
      query: "needle",
    });
    assert.equal(result.matches.length, 2);
    assert.equal(result.skippedFiles, 3);
    assert.ok(result.matches.every((m) => m.relativePath === "good.txt"));
    const limited = await service.searchWorkspaceText({
      rootPath,
      requestId: "limit",
      query: "needle",
      limit: 1,
    });
    assert.equal(limited.matches.length, 1);
    assert.equal(limited.truncated, true);
    await writeFile(join(rootPath, "created.txt"), "new unique text");
    assert.equal(
      (await service.searchWorkspaceText({ rootPath, requestId: "fresh", query: "unique" }))
        .matches[0]?.relativePath,
      "created.txt",
    );
    assert.equal(
      (await service.searchWorkspaceText({ rootPath, requestId: "empty", query: "" })).matches
        .length,
      0,
    );
  });
});

test("索引等待期间可取消；同路径不同身份不能互相取消，释放后可重用 ID", async () => {
  await fixture(async (rootPath) => {
    let release!: (packed: string) => void;
    const methods = createWorkspaceTextSearch(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const params = {
      rootPath,
      workspaceIdentity: "remote-a",
      requestId: "pending",
      query: "needle",
    };
    const pending = methods.searchWorkspaceText(params);
    assert.equal(
      await methods.cancelWorkspaceTextSearch({ ...params, workspaceIdentity: "remote-b" }),
      false,
    );
    assert.equal(await methods.cancelWorkspaceTextSearch(params), true);
    release("file\tmissing.txt");
    const result = await pending;
    assert.equal(result.cancelled, true);
    assert.equal(result.searchedFiles, 0);
    assert.equal(await methods.cancelWorkspaceTextSearch(params), false);
    const again = methods.searchWorkspaceText(params);
    release("");
    assert.equal((await again).cancelled, false);
  });
});

test("索引候选仍须通过真实路径围栏；非法关键词/上限在读取前拒绝", async () => {
  await fixture(async (rootPath) => {
    const scope = join(rootPath, "scope");
    await mkdir(scope);
    await writeFile(join(rootPath, "outside.txt"), "needle outside");
    let scans = 0;
    const methods = createWorkspaceTextSearch(async () => {
      scans++;
      return "file\t../outside.txt";
    });
    const params = { rootPath: scope, requestId: "boundary", query: "needle" };
    const result = await methods.searchWorkspaceText(params);
    assert.equal(result.matches.length, 0);
    assert.equal(result.skippedFiles, 1);
    await assert.rejects(methods.searchWorkspaceText({ ...params, query: "x".repeat(513) }));
    await assert.rejects(methods.searchWorkspaceText({ ...params, query: "a\nb" }));
    await assert.rejects(methods.searchWorkspaceText({ ...params, limit: 0 }));
    assert.equal(scans, 1);
  });
});

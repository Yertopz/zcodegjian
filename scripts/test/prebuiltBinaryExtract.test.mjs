import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import yazl from "yazl";
import { extractPrebuiltArchive } from "../prebuilt-binary-extract.mjs";

test(
  "Windows ZIP extraction ignores incompatible Archive modules and preserves quoted paths",
  {
    skip: process.platform !== "win32",
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode zip's "));
    const originalModulePath = process.env.PSModulePath;
    try {
      const modules = join(root, "modules");
      const archiveModule = join(modules, "Microsoft.PowerShell.Archive");
      await mkdir(archiveModule, { recursive: true });
      // 模拟 pwsh 向 Windows PowerShell 传入不兼容模块，禁止回归到自动发现的解压命令。
      await writeFile(
        join(archiveModule, "Microsoft.PowerShell.Archive.psm1"),
        "function Expand-Archive { throw 'Incompatible Archive module loaded' }; Export-ModuleMember -Function Expand-Archive",
      );
      process.env.PSModulePath = [modules, originalModulePath].filter(Boolean).join(delimiter);

      const archivePath = join(root, "tool's archive.zip");
      const zip = new yazl.ZipFile();
      const finished = pipeline(zip.outputStream, createWriteStream(archivePath));
      zip.addBuffer(Buffer.from("newly compiled binary"), "nested/ugrep.exe");
      zip.end();
      await finished;

      const extractDir = join(root, "tool's output");
      extractPrebuiltArchive({ archivePath, archiveExt: "zip", extractDir, cwd: root });
      assert.equal(
        await readFile(join(extractDir, "nested/ugrep.exe"), "utf8"),
        "newly compiled binary",
      );
    } finally {
      if (originalModulePath === undefined) delete process.env.PSModulePath;
      else process.env.PSModulePath = originalModulePath;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "Windows corrupt ZIP fails at extraction instead of reporting a missing binary",
  {
    skip: process.platform !== "win32",
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-bad-zip-"));
    try {
      const archivePath = join(root, "corrupt.zip");
      await writeFile(archivePath, "not a ZIP archive");
      assert.throws(
        () =>
          extractPrebuiltArchive({
            archivePath,
            archiveExt: "zip",
            extractDir: join(root, "output"),
            cwd: root,
          }),
        /powershell\.exe .*failed with code/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

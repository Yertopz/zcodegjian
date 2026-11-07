import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, rmSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyWindowsExecutableResources,
  assertWindowsExecutableResources,
  buildWindowsExecutableMetadata,
  findWindowsExecutableResourceIssues,
  readWindowsIconSizes,
} from "../scripts/windows-executable-resources.mjs";

/**
 * Windows 产物 exe 的图标与版本资源护栏。
 *
 * 为什么钉住：本仓库为了绕开 winCodeSign（联网下载 + 7za 解压 + macOS 符号链接）关闭了
 * electron-builder 的 `signAndEditExecutable`，exe 的图标/版本信息改由 afterPack 用 resedit
 * 写入。写不进去时构建全程绿灯，但用户看到的是 Electron 默认图标 —— 这正是本次要修的现象，
 * 所以既要测期望值生成，也要测「回读校验能抓住没写成功的产物」。
 */

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const iconPath = join(repoRoot, "packages", "desktop", "build", "icon.ico");

const metadata = buildWindowsExecutableMetadata({
  productName: "ZCode-CE",
  productFilename: "ZCode-CE",
  version: "3.16.3-ce.1",
  companyName: "ZCode",
  copyright: "Copyright © 2026 ZCode",
});

test("版本字符串取数字部分，预发布后缀不写入 Windows 版本资源", () => {
  assert.deepEqual(metadata.fixedVersion, { major: 3, minor: 16, patch: 3, build: 0 });
  assert.deepEqual(metadata.strings, {
    FileDescription: "ZCode-CE",
    ProductName: "ZCode-CE",
    CompanyName: "ZCode",
    LegalCopyright: "Copyright © 2026 ZCode",
    InternalName: "ZCode-CE",
    OriginalFilename: "",
    FileVersion: "3.16.3",
    ProductVersion: "3.16.3",
  });
});

test("应用图标包含 16/32/48/256 等尺寸，256 归一化后仍可比较", async () => {
  const icons = await readWindowsIconSizes(iconPath);
  for (const size of ["16x16", "32x32", "48x48", "256x256"]) {
    assert.ok(icons.includes(size), `build/icon.ico 缺少 ${size}，实际：${icons.join(", ")}`);
  }
});

test("回读校验：资源全部匹配时没有问题", () => {
  const issues = findWindowsExecutableResourceIssues({
    expected: { strings: metadata.strings, icons: ["16x16", "256x256"] },
    actual: {
      strings: { ...metadata.strings },
      icons: ["16x16", "256x256"],
    },
  });
  assert.deepEqual(issues, []);
});

test("回读校验：仍是 Electron 图标/元数据时必须报出差异", () => {
  const issues = findWindowsExecutableResourceIssues({
    expected: { strings: metadata.strings, icons: ["16x16", "256x256"] },
    actual: {
      strings: {
        ...metadata.strings,
        ProductName: "Electron",
        CompanyName: "GitHub, Inc.",
        FileVersion: "41.0.3",
      },
      icons: ["16x16"],
    },
  });
  assert.equal(issues.length, 4);
  assert.ok(
    issues.some((issue) => issue.includes("ProductName") && issue.includes("Electron")),
    "必须点名 ProductName 仍是 Electron：" + issues.join(" | "),
  );
  assert.ok(
    issues.some((issue) => issue.includes("256x256")),
    "必须点名缺失的 256x256 图标：" + issues.join(" | "),
  );
});

/**
 * 真实 PE 往返：只在 Windows 且本机有 Electron 运行时副本时执行。
 *
 * Linux CI 上不跑（`pnpm test` 跑在 ubuntu-latest），但 Windows 本地与 Windows runner 上
 * 能验证 resedit 写入后 exe 仍可被重新解析、图标与版本字符串都能读回。
 */
test("真实 exe 往返：写图标 + 版本资源后可回读校验", async (t) => {
  if (process.platform !== "win32") {
    t.skip("仅 Windows 上验证 PE 资源写入");
    return;
  }
  const electronExecutable = join(repoRoot, "node_modules", "electron", "dist", "electron.exe");
  if (!existsSync(electronExecutable)) {
    t.skip("本机没有 node_modules/electron/dist/electron.exe");
    return;
  }
  // 夹具是整份 Electron 运行时（约 235 MB），临时目录放不下时显式跳过而不是报一个误导性的 ENOSPC。
  const minimumBytes = 400 * 1024 * 1024;
  const temporaryRoot = tmpdir();
  const temporaryStats = statfsSync(temporaryRoot);
  const availableBytes = temporaryStats.bavail * temporaryStats.bsize;
  if (availableBytes < minimumBytes) {
    t.skip(`临时目录可用空间不足 ${minimumBytes / 1024 / 1024} MB：${temporaryRoot}`);
    return;
  }

  const workDir = mkdtempSync(join(temporaryRoot, "zcode-exe-resources-"));
  const executablePath = join(workDir, "ZCode-CE.exe");
  try {
    copyFileSync(electronExecutable, executablePath);
    await applyWindowsExecutableResources({ executablePath, iconPath, metadata });
    const resources = await assertWindowsExecutableResources({
      executablePath,
      iconPath,
      metadata,
    });
    assert.equal(resources.strings.ProductName, "ZCode-CE");
    assert.equal(resources.strings.CompanyName, "ZCode");
    assert.ok(
      resources.icons.includes("256x256"),
      "写入后必须能读回 256x256 图标，实际：" + resources.icons.join(", "),
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

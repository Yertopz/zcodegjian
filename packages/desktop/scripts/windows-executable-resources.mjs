import { readFile, rename, rm, writeFile } from "node:fs/promises";
import * as ResEdit from "resedit";

/**
 * 给 Windows 产物的 exe 写入应用图标与版本资源。
 *
 * 为什么本仓库要自己做这件事：electron-builder 的 exe 图标/版本信息来自
 * `WinPackager.signAndEditResources`，而它受 `win.signAndEditExecutable` 控制；
 * 这条路径在 Windows 本地会调用 app-builder 的 `rcedit` 子命令，后者需要联网下载
 * winCodeSign 包并依赖 PATH 里的 `7za` 解压（其中还带 macOS 符号链接，未启用开发者
 * 模式的 Windows 解压会失败）。因此本仓库把该开关关掉，改用纯 JS 的 resedit 直接重写
 * PE 资源：离线、跨平台、不需要 winCodeSign。
 *
 * 关闭该开关的代价是 exe 会保留 Electron 自带的原子图标和 "Electron / GitHub, Inc."
 * 元数据 —— 桌面、开始菜单、任务栏固定图标都会显示成 Electron。所以这里必须补上，
 * 并在 afterPack 阶段回读校验（见 electron-builder.config.js）。
 */

const VERSION_LANG = 1033;
const VERSION_CODEPAGE = 1200;

function parseWindowsVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  if (!match) {
    throw new Error(`[windows-executable-resources] 无法解析应用版本号：${String(version)}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * 生成要写入 exe 的版本字符串与固定版本号。
 *
 * 只取应用版本的数字部分：`3.16.3-ce.1` 这类预发布后缀属于应用自身，Windows 版本资源
 * 用 `3.16.3` 即可，避免 Explorer 里出现 "3.16.3.0" 与 "3.16.3" 两套写法。
 */
export function buildWindowsExecutableMetadata({
  productName,
  productFilename,
  version,
  companyName,
  copyright,
}) {
  const { major, minor, patch } = parseWindowsVersion(version);
  const shortVersion = `${major}.${minor}.${patch}`;
  return {
    fixedVersion: { major, minor, patch, build: 0 },
    strings: {
      FileDescription: productName,
      ProductName: productName,
      CompanyName: companyName,
      LegalCopyright: copyright,
      InternalName: productFilename,
      OriginalFilename: "",
      FileVersion: shortVersion,
      ProductVersion: shortVersion,
    },
  };
}

/**
 * 256x256 图标在 ICO 目录与 PE 图标资源里都编码为 0，统一归一化成 256，
 * 避免「图标明明写进去了却校验不过」。
 */
function normalizeIconDimension(value) {
  return value === 0 ? 256 : value;
}

function iconSizeKey({ width, height }) {
  return `${normalizeIconDimension(width)}x${normalizeIconDimension(height)}`;
}

function readVersionStrings(versionInfo) {
  const languages = versionInfo.getAllLanguagesForStringValues();
  const language = languages[0] ?? { lang: VERSION_LANG, codepage: VERSION_CODEPAGE };
  return versionInfo.getStringValues(language);
}

export async function readWindowsExecutableResources(executablePath) {
  const buffer = await readFile(executablePath);
  const executable = ResEdit.NtExecutable.from(buffer, { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (versions.length === 0) {
    throw new Error(`[windows-executable-resources] 可执行文件没有版本资源：${executablePath}`);
  }
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  return {
    strings: readVersionStrings(versions[0]),
    icons: groups.flatMap((group) => group.icons.map(iconSizeKey)),
  };
}

export async function readWindowsIconSizes(iconPath) {
  const iconFile = ResEdit.Data.IconFile.from(await readFile(iconPath));
  return iconFile.icons.map((icon) => iconSizeKey({ width: icon.width, height: icon.height }));
}

/**
 * 回读校验：exe 里必须出现期望的版本字符串与全部图标尺寸，否则出包失败。
 *
 * 这里选择 fail-closed 而不是告警：资源没写进去时用户看到的是 Electron 默认图标，
 * 而构建全程绿灯 —— 正是本仓库反复出现的「验证停在中间产物」模式。
 */
export function findWindowsExecutableResourceIssues({ expected, actual }) {
  const issues = [];
  for (const [key, value] of Object.entries(expected.strings)) {
    if (actual.strings[key] !== value) {
      issues.push(
        `版本资源 ${key} 期望 ${JSON.stringify(value)}，实际 ${JSON.stringify(actual.strings[key] ?? null)}`,
      );
    }
  }
  for (const iconSize of expected.icons) {
    if (!actual.icons.includes(iconSize)) {
      issues.push(`缺少 ${iconSize} 图标（实际：${actual.icons.join(", ") || "无"}）`);
    }
  }
  return issues;
}

/**
 * 把图标与版本资源写回 exe。
 *
 * resedit 明确不建议把结果写回源文件，所以先写同目录临时文件再 rename 覆盖；PE 体积较大
 * （Electron 41 的 exe 约 220 MB），一次读入内存即可，不再额外复制中间产物。
 */
export async function applyWindowsExecutableResources({ executablePath, iconPath, metadata }) {
  const buffer = await readFile(executablePath);
  const executable = ResEdit.NtExecutable.from(buffer, { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);

  const iconFile = ResEdit.Data.IconFile.from(await readFile(iconPath));
  if (iconFile.icons.length === 0) {
    throw new Error(`[windows-executable-resources] 图标文件没有可用图像：${iconPath}`);
  }
  const iconItems = iconFile.icons.map((item) => item.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  if (groups.length === 0) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      1,
      VERSION_LANG,
      iconItems,
    );
  } else {
    for (const group of groups) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        group.id,
        group.lang,
        iconItems,
      );
    }
  }

  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (versions.length === 0) {
    throw new Error(`[windows-executable-resources] 可执行文件没有版本资源：${executablePath}`);
  }
  for (const versionInfo of versions) {
    const languages = versionInfo.getAllLanguagesForStringValues();
    const targets =
      languages.length > 0 ? languages : [{ lang: VERSION_LANG, codepage: VERSION_CODEPAGE }];
    for (const language of targets) {
      versionInfo.setStringValues(language, metadata.strings);
      versionInfo.setFileVersion(
        metadata.fixedVersion.major,
        metadata.fixedVersion.minor,
        metadata.fixedVersion.patch,
        metadata.fixedVersion.build,
        Number(language.lang),
      );
      versionInfo.setProductVersion(
        metadata.fixedVersion.major,
        metadata.fixedVersion.minor,
        metadata.fixedVersion.patch,
        metadata.fixedVersion.build,
        Number(language.lang),
      );
      // 上面两个 setter 会把字符串改写成四段数字，这里恢复成与应用版本一致的短版本。
      versionInfo.setStringValue(language, "FileVersion", metadata.strings.FileVersion);
      versionInfo.setStringValue(language, "ProductVersion", metadata.strings.ProductVersion);
    }
    versionInfo.outputToResourceEntries(resources.entries);
  }

  resources.outputResource(executable);
  const temporaryPath = `${executablePath}.zcode-resources.tmp`;
  try {
    await writeFile(temporaryPath, Buffer.from(executable.generate()));
    await rename(temporaryPath, executablePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * 出包期护栏：写入后立刻回读，和期望值逐项比对。返回实际资源便于打日志。
 */
export async function assertWindowsExecutableResources({ executablePath, iconPath, metadata }) {
  const expected = {
    strings: metadata.strings,
    icons: await readWindowsIconSizes(iconPath),
  };
  const actual = await readWindowsExecutableResources(executablePath);
  const issues = findWindowsExecutableResourceIssues({ expected, actual });
  if (issues.length > 0) {
    throw new Error(
      `Windows exe 图标/版本资源校验失败 (${executablePath}):\n- ${issues.join("\n- ")}`,
    );
  }
  return actual;
}

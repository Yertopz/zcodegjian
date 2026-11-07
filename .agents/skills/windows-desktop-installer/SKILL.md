---
name: windows-desktop-installer
description: Build the current repository's Windows x64 Electron NSIS installer. Use whenever the user asks to compile, package, build, or generate a Windows installer/exe for this project, including requests such as “只要 win 端”, “打包 Windows”, or “生成安装包”.
---

# Windows Desktop Installer

为当前仓库生成 Windows x64 Electron NSIS 安装包。只处理 Windows 目标，不生成 Linux 或 macOS 产物。

## 开始前

1. 阅读根 `AGENTS.md`、`docs/operations/release.md` 和 `docs/development/local-setup.md`。
2. 确认当前 shell 运行在 Windows；Windows 包不能从 Linux 交叉构建。
3. 从根 `package.json` 读取当前版本，不要把旧版本安装包当作本次结果。
4. 保留用户已有的本地改动，不执行 `git reset --hard`、`git checkout --` 或清理无关文件。
5. 若是代码行为改动，先按仓库规则更新 spec、执行架构检查和相关测试；单纯构建不修改业务代码。

## 标准构建

从仓库根目录运行：

```powershell
$env:ZCODE_ENV = 'production'
pnpm bundle:desktop --os win --arch x64
```

Windows PowerShell 构建前必须显式设置 `ZCODE_ENV=production`：未设置时构建器按安全默认值生成连接测试环境的 Preview 身份，并在文件名加 `_TEST`，不能作为已安装的正式 ZCode-CE 更新包交付。

该入口已经包含运行时资产准备、项目构建、Electron Builder、产物校验和体积审计；不要重复执行 `prepare:runtime-assets` 或各包的 build。

预期安装包路径：

```text
packages/desktop/dist/ZCode-CE-<当前版本>-win-x64.exe
```

同时应有对应的 `.blockmap` 和 `latest.yml`。

## Windows 无签名构建

`packages/desktop/electron-builder.config.js` 的 `win` 配置固定保留：

```js
signAndEditExecutable: false,
```

原因不是「省掉签名」，而是关掉 electron-builder 的 exe 资源编辑链路：它在 Windows 上要走 app-builder 的 `rcedit`，需要联网下载 `winCodeSign`、依赖 PATH 里的 `7za` 解压，而该包带 macOS 符号链接，未启用开发者模式的 Windows 会报：

```text
ERROR: Cannot create symbolic link
```

因此 exe 的**应用图标与版本资源改由 afterPack 用纯 JS 的 `resedit` 写入并回读校验**（`packages/desktop/scripts/windows-executable-resources.mjs`）。**不要把这个开关改成 `true`**：一旦改回去，本地构建会在 `winCodeSign` 阶段失败；即使侥幸成功，也把图标/元数据的正确性重新绑到联网下载上。资源没写进去时 afterPack 会直接让构建失败，不要跳过该校验。

需要绕过完整 `bundle:desktop` 时，可以从 `packages/desktop` 直接运行：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --config electron-builder.config.js --win --x64
```

该方式复用已经完成的 `dist/win-unpacked` 前置产物。安装包仍然可以生成，但属于未签名包，Windows SmartScreen 可能显示警告。`winCodeSign` 相关失败按上面的机制排查，不要通过打开 `signAndEditExecutable` 规避。

## 验收

构建退出码必须为 `0`，并检查最终消费点：

```bash
find packages/desktop/dist -maxdepth 1 -type f -printf '%f %s bytes\\n' | sort
```

确认：

- 存在当前版本的 `ZCode-CE-<version>-win-x64.exe`；
- 文件名版本与根 `package.json` 完全一致；
- 存在同名 `.blockmap`；
- 不要使用 `ZCode-CE-<旧版本>-win-x64.exe` 冒充本次产物；
- 报告安装包绝对路径、文件大小和是否签名。

图标与版本资源打到最终 exe（桌面/开始菜单/任务栏固定图标都用它，NSIS 快捷方式指向 `$appExe,0`）：

```powershell
$exe = "packages\desktop\dist\win-unpacked\ZCode-CE.exe"
(Get-Item $exe).VersionInfo | Select-Object ProductName, CompanyName, FileVersion
```

`ProductName` 必须是 `ZCode-CE`、`CompanyName` 必须是 `ZCode`。若显示 `Electron` / `GitHub, Inc.`，说明 afterPack 的资源写入没生效，按失败处理，不要交付。

可选地计算校验值：

```powershell
Get-FileHash "packages\\desktop\\dist\\ZCode-CE-<version>-win-x64.exe" -Algorithm SHA256
```

## 失败处理

- `winCodeSign` 符号链接失败：确认 `win.signAndEditExecutable` 仍是 `false`；不要把它打开来规避。
- exe 版本信息仍是 `Electron` / `GitHub, Inc.`：afterPack 的 `applyWindowsExecutableResources` 没生效或校验被跳过，检查 `scripts/windows-executable-resources.mjs` 与 `afterPack` 调用，修好后重新出包。
- 下载 `nsis` 或 `nsis-resources` 失败：检查网络后重试；不要把旧产物当作成功。
- 前置构建或 afterPack 校验失败：报告准确失败阶段和错误，不跳过校验、不手工拼装安装包。
- 只有 `dist/win-unpacked`：这只是解包应用目录，不是安装包；继续处理 NSIS 或明确报告安装包尚未生成。
- 发现版本不一致：停止交付并以根 `package.json` 的当前版本为准重新核对。

## 交付格式

最终答复简洁说明：

1. Windows x64 NSIS 是否成功；
2. 安装包绝对路径；
3. 版本、大小、SHA256（如已计算）；
4. 是否未签名，以及 SmartScreen 注意事项；
5. 若失败，写明失败阶段和可执行的下一步，不要模糊描述为“构建中”。

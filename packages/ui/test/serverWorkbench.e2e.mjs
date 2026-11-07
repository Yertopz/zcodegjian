import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import { _electron as electron } from "playwright-core";
import electronPath from "electron";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// 真实 Electron/React 组件，RPC fixture 不连接远端。临时预算 32 MiB，复用 Electron 并回收 profile。
test(
  "SSH 工作台 UI：Windows 配置、三分区、终端树和逐次审批、后台不抢对话",
  { timeout: 180000 },
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), "zcode-server-ui-"));
    let app;
    try {
      const bundle = await build({
        entryPoints: [resolve("packages/ui/test/support/serverWorkbenchHarness.tsx")],
        outdir: scratch,
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        tsconfig: resolve("packages/ui/tsconfig.json"),
        define: { "process.env.NODE_ENV": '"test"', "import.meta": '{"url":"file:///fixture/"}' },
        loader: { ".woff2": "empty" },
      });
      for (const file of bundle.outputFiles) await writeFile(file.path, file.contents);
      // 使用项目真正的 Tailwind/CSS，防止无样式 fixture 只能验证 DOM、漏掉浮层重叠。
      const desktopRequire = createRequire(resolve("packages/desktop/package.json"));
      const { build: buildStyles } = await import(
        pathToFileURL(desktopRequire.resolve("vite")).href
      );
      const { default: tailwindcss } = await import(
        pathToFileURL(desktopRequire.resolve("@tailwindcss/vite")).href
      );
      const styles = await buildStyles({
        configFile: false,
        root: resolve("packages/desktop"),
        logLevel: "error",
        plugins: [tailwindcss()],
        build: {
          write: false,
          emptyOutDir: false,
          rolldownOptions: { input: resolve("packages/ui/src/styles.css") },
        },
      });
      const css = styles.output.find((a) => a.type === "asset" && a.fileName.endsWith(".css"));
      assert.ok(css);
      await writeFile(join(scratch, "app.css"), css.source);
      await writeFile(
        join(scratch, "index.html"),
        '<meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="serverWorkbenchHarness.css"><script src="serverWorkbenchHarness.js"></script>',
      );
      await writeFile(
        join(scratch, "main.cjs"),
        `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1450,height:1100});w.loadURL('about:blank');});`,
      );
      const env = { ...process.env, NO_PROXY: "localhost,127.0.0.1,::1" };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        executablePath: electronPath,
        args: [join(scratch, "main.cjs")],
        env,
      });
      const page = await app.firstWindow(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.stack || e.message));
      await page.goto(pathToFileURL(join(scratch, "index.html")).href);
      await page
        .getByTestId("ssh-sidebar-entry")
        .waitFor({ timeout: 10000 })
        .catch((error) => {
          throw new Error(`${error.message}; renderer errors: ${JSON.stringify(errors)}`);
        });
      const toggle = page.getByRole("button", { name: "切换侧边栏", exact: true });
      const assertNoOverlap = async (testId) => {
        await page.waitForFunction((id) => {
          const actions = document.querySelector('[data-testid="desktop-top-overlay-actions"]');
          const first = document.querySelector(`[data-testid="${id}"] button`);
          return (
            first &&
            actions &&
            first.getBoundingClientRect().left >= actions.getBoundingClientRect().right + 4
          );
        }, testId);
      };
      await page
        .getByTestId("ssh-sidebar-entry")
        .getByRole("button", { name: "SSH 服务", exact: true })
        .first()
        .click();
      for (const width of [1450, 900]) {
        await page.setViewportSize({ width, height: 1100 });
        await toggle.click();
        await assertNoOverlap("server-workbench-toolbar");
        await toggle.click();
      }
      await page.getByRole("button", { name: "打开测试浏览器", exact: true }).click();
      await page
        .getByTestId("browser-console-toolbar")
        .getByRole("button", { name: "Default", exact: true })
        .waitFor();
      await toggle.click();
      await assertNoOverlap("browser-console-toolbar");
      assert.equal(
        await page
          .getByTestId("browser-console-toolbar")
          .getByTestId("desktop-window-controls")
          .count(),
        1,
      );
      await toggle.click();
      await page
        .getByTestId("ssh-sidebar-entry")
        .getByRole("button", { name: "SSH 服务", exact: true })
        .first()
        .click();
      await page.setViewportSize({ width: 1450, height: 1100 });
      await page.getByRole("button", { name: "添加服务器", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("名称", { exact: true }).fill("Windows 测试机");
      await dialog.getByLabel("主机地址", { exact: true }).fill("windows.invalid");
      await dialog.getByLabel("用户名", { exact: true }).fill("test-user");
      await dialog.getByLabel("系统", { exact: true }).selectOption("windows");
      await dialog.getByLabel("SSH 密码", { exact: true }).fill("FixtureZ-123!");
      await dialog.getByLabel("RDP 密码", { exact: true }).fill("RdpFixture!");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      assert.deepEqual(
        await page.evaluate(
          () => window.serverWorkbenchTest.requests.find((r) => r.op === "save").credentials,
        ),
        { password: "FixtureZ-123!", rdpPassword: "RdpFixture!" },
      );
      await page
        .getByTestId("server-card")
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      assert.equal(await dialog.getByLabel("SSH 密码", { exact: true }).inputValue(), "");
      assert.equal(
        await dialog.getByLabel("SSH 密码", { exact: true }).getAttribute("placeholder"),
        "已保存，留空继续使用",
      );
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page
        .getByTestId("server-card")
        .getByRole("button", { name: "连接 SSH", exact: true })
        .click();
      assert.equal(
        await dialog.getByLabel("SSH 密码", { exact: true }).getAttribute("placeholder"),
        "已保存，留空继续使用",
      );
      await page.getByRole("dialog").getByRole("button", { name: "连接 SSH", exact: true }).click();
      await page.getByRole("button", { name: "新建终端", exact: true }).click();
      await page.getByTestId("server-terminal").waitFor();
      await page.getByTestId("server-assistant").waitFor();
      await page.getByTestId("server-files").waitFor();
      assert.equal(
        await page.getByTestId("desktop-window-controls").filter({ visible: true }).count(),
        1,
      );
      await page.getByRole("button", { name: "SSH 服务", exact: true }).count();
      await page
        .getByTestId("ssh-sidebar-entry")
        .getByRole("button", { name: "SSH 服务", exact: true })
        .last()
        .click();
      await page
        .getByTestId("ssh-sidebar-entry")
        .getByRole("button", { name: "terminal-0", exact: true })
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
      await page.getByRole("dialog").getByLabel("名称", { exact: true }).fill("保留的会话");
      await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
      const assistant = page.getByTestId("server-assistant");
      await assistant.getByRole("textbox").first().fill("检查 Windows 服务错误");
      await assistant.getByRole("button", { name: "分析", exact: true }).click();
      await page.getByTestId("server-approval").waitFor();
      assert.equal(
        await page.evaluate(() =>
          window.serverWorkbenchTest.requests.some((r) => r.op === "decide"),
        ),
        false,
      );
      await page.getByRole("button", { name: "同意本次", exact: true }).click();
      assert.equal(
        await page.evaluate(
          () =>
            window.serverWorkbenchTest.requests.filter((r) => r.op === "decide" && r.allow).length,
        ),
        1,
      );
      await page.getByRole("button", { name: "返回对话", exact: true }).click();
      const draft = page.getByRole("textbox", { name: "对话草稿" });
      await draft.fill("保留草稿和焦点");
      await page.evaluate(() => window.serverWorkbenchTest.background());
      assert.equal(await page.getByTestId("view").textContent(), "chat");
      assert.equal(await draft.inputValue(), "保留草稿和焦点");
      assert.equal(await draft.evaluate((n) => n === document.activeElement), true);
      await page
        .getByTestId("ssh-sidebar-entry")
        .getByRole("button", { name: "保留的会话", exact: true })
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "关闭终端", exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => window.serverWorkbenchTest.requests.filter((r) => r.op === "terminalClose").length,
        ),
        1,
      );
      assert.deepEqual(errors, []);
    } finally {
      await app?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

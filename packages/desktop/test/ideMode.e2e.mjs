import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { preview } from "vite";
import { launchIdeElectron } from "./support/ideElectron.mjs";
import { startIdeModelServer } from "./support/ideModelServer.mjs";
import { checkIdeLinking } from "./support/ideLinkingChecks.mjs";
import { checkComposerEnhancements } from "./support/composerEnhancementChecks.mjs";
import { checkIdeSearch } from "./support/ideSearchChecks.mjs";
import {
  checkIdeEditorSwitch,
  checkIdeEditorCacheEviction,
} from "./support/ideEditorSwitchChecks.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");

// 独立真实桌面验收，不伪造 FileService；只通过既有 E2E 导航桥打开临时工作区。
test(
  "IDE desktop: open, edit, save, conflict, reload, exit, stable chat",
  { timeout: 1200000 },
  async () => {
    const base = join(root, ".local", "ide-e2e");
    const reports = join(root, ".local", "reports", "ide-e2e");
    await mkdir(base, { recursive: true });
    await mkdir(reports, { recursive: true });
    const run = await mkdtemp(join(base, "run-"));
    const model = await startIdeModelServer();
    const workspace = join(run, "workspace");
    await mkdir(workspace);
    await mkdir(join(run, "home"));
    // 隔离目录只连接本机假模型；真实 CLI、权限与文件服务参与整条提交链路。
    const providerConfigDir = join(run, "home", ".zcode", "v2");
    await mkdir(providerConfigDir, { recursive: true });
    await writeFile(
      join(providerConfigDir, "provider_config.json"),
      JSON.stringify({
        schemaVersion: 1,
        config: {
          providerConfigRules: {
            providerRules: [
              {
                providerId: "ide-e2e",
                providerName: "IDE offline",
                enabled: true,
                config: {
                  group: "standard-personal",
                  access: { type: "api-key", apiKey: "ide-e2e-not-a-real-key" },
                  api: { type: "openai-chat-completions", baseUrl: model.url },
                  personalModelIds: ["ide-offline"],
                },
              },
            ],
          },
          modelConfigRules: {
            providerModelRules: [
              { providerId: "ide-e2e", modelId: "ide-offline", config: { enabled: true } },
            ],
            manualProviderModelRules: [],
          },
          defaultModelSelection: { providerId: "ide-e2e", modelId: "ide-offline" },
        },
      }),
    );
    const file = join(workspace, "sample.ts");
    model.setFile(file);
    await writeFile(file, "\ufeffconst original = 1;\r\n");
    await writeFile(join(workspace, "empty.txt"), "");
    for (let index = 0; index < 6; index++) {
      await writeFile(join(workspace, `cache-${index}.ts`), `export const cache = ${index};`);
    }
    await writeFile(
      join(workspace, "scroll.ts"),
      Array.from({ length: 150 }, (_, index) => `// line ${index} ${"wide ".repeat(60)}`).join(
        "\n",
      ),
    );
    await mkdir(join(workspace, "nested"));
    const searchFile = join(workspace, "nested", "search-target.ts");
    await writeFile(
      searchFile,
      '\ufeff// search fixture\r\nconst label = "IDE_SEARCH_文本";\r\nconst same = "ide_search_文本";\r\n',
    );
    await writeFile(join(workspace, "nested", "linked.ts"), "export const linked = true;\n");
    const originalCwd = process.cwd();
    const oldBridge = process.env.VITE_ZCODE_E2E_STORE_BRIDGE;
    const oldTemp = process.env.TEMP;
    const oldTmp = process.env.TMP;
    process.env.VITE_ZCODE_E2E_STORE_BRIDGE = "1";
    // Playwright 在启动父进程中创建产物目录，仅设置 Electron 子进程环境不足以隔离。
    process.env.TEMP = run;
    process.env.TMP = run;
    process.chdir(desktop);
    let server;
    let app;
    let page;
    const errors = [];
    try {
      const rendererDir = join(base, "renderer");
      // 验收构建产物，避免 dev 依赖重新优化触发整页重载、干扰草稿断言。
      // 本地调试可复用同一份已构建产物；标准入口始终重新构建。
      if (process.env.ZCODE_IDE_E2E_REUSE_RENDERER !== "1") {
        console.log("IDE E2E: building renderer");
        // 构建放到独立进程，退出即释放模块图内存，避免与 Electron 争用本机内存。
        const { stdout, stderr } = await promisify(execFile)(
          process.execPath,
          [join(desktop, "test/support/buildIdeRenderer.mjs")],
          {
            cwd: desktop,
            env: process.env,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        process.stdout.write(stdout);
        process.stderr.write(stderr);
      }
      console.log("IDE E2E: serving renderer");
      server = await preview({
        configFile: join(desktop, "vite.config.ts"),
        mode: "development",
        build: { outDir: rendererDir },
        preview: { host: "127.0.0.1", port: 5187, strictPort: false },
        clearScreen: false,
      });
      const url = server.resolvedUrls.local[0];
      console.log("IDE E2E: launching isolated Electron");
      const env = {
        ...process.env,
        ELECTRON_RENDERER_URL: url,
        ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
        ZCODE_DESKTOP_APPLICATION_NAME: "ZCode IDE E2E " + process.pid,
        ZCODE_DESKTOP_HOME_DIR: join(run, "home"),
        // CLI 的 Node os.homedir 也必须隔离，不能只覆盖 Electron 的 app home。
        USERPROFILE: join(run, "home"),
        ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(providerConfigDir, "provider_config.json"),
        ZCODE_DATA_BASE_DIR: join(run, "home"),
        ZCODE_DESKTOP_USER_DATA_DIR: join(run, "electron"),
        ZCODE_DESKTOP_SESSION_DATA_DIR: join(run, "session"),
        ZCODE_E2E_RUN_ID: "ide-" + process.pid,
        VITE_ZCODE_E2E_STORE_BRIDGE: "1",
        TEMP: run,
        TMP: run,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      // 验收当前仓库的 CLI，不继承用户自定义 Agent 启动命令。
      delete env.ZCODE_AGENT_SERVER_COMMAND;
      delete env.ZCODE_AGENT_SERVER_ARGS_JSON;
      // Electron 是独立应用，不继承 node:test 子进程的 IPC/运行器身份。
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_CHANNEL_FD;
      delete env.NODE_UNIQUE_ID;
      app = await launchIdeElectron({
        // 与 electron . 一致从 package.json 入口启动；直传 out/main 会改变 appPath，找不到内置配置。
        args: [desktop, "--disable-gpu", "--enable-logging=stderr"],
        cwd: desktop,
        env,
      });
      page = await app.firstWindow({ timeout: 90000 });
      page.setDefaultTimeout(60000);
      page.on("pageerror", (error) => {
        errors.push(error.message);
        console.error("IDE renderer error:", error.message);
      });
      await page.waitForFunction(() => Boolean(window.__zcodeTabStoreE2E), undefined, {
        timeout: 120000,
      });
      await page.evaluate((path) => window.__zcodeTabStoreE2E.getState().addTab(path), workspace);
      console.log("IDE E2E: workspace opened");
      // 新数据目录可能显示首次使用页，走真实关闭按钮完成测试前置条件。
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="onboarding-page"]') ||
          document.querySelector('[data-testid="ide-mode-toggle"]') ||
          document.querySelector('[data-testid="login-use-api-key-button"]'),
        undefined,
        { timeout: 90000 },
      );
      const apiKeyEntry = page.getByTestId("login-use-api-key-button");
      if (await apiKeyEntry.isVisible()) {
        await apiKeyEntry.click();
        await page.getByTestId("login-api-key-skip-button").click();
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="onboarding-page"]') ||
            document.querySelector('[data-testid="ide-mode-toggle"]'),
        );
      }
      const onboarding = page.getByTestId("onboarding-page");
      if (await onboarding.isVisible()) {
        // 首次使用页同时含原生窗口关闭按钮，必须限定到引导页的 header。
        await onboarding.locator("header button").last().click();
        await onboarding.waitFor({ state: "detached" });
      }
      // 首次引导结束会重建默认草稿工作区，导航必须在引导完成后提交。
      await page.evaluate((path) => window.__zcodeTabStoreE2E.getState().addTab(path), workspace);
      const toggle = page.getByTestId("ide-mode-toggle").first();
      await toggle.waitFor({ state: "visible", timeout: 90000 });
      const previousMode = await toggle.getAttribute("data-interface-mode");
      assert.ok(previousMode === "coding" || previousMode === "office");
      // DOM 标识用来证明聊天编辑器没有在模式切换时重挂。
      const chat = page.locator('[contenteditable="true"]').first();
      await chat.waitFor({ state: "visible" });
      await chat.fill("chat draft preserved");
      await chat.evaluate((node) => {
        node.dataset.ideChatIdentity = "original";
      });
      await toggle.click();
      await page.locator("[data-ide-workbench]").waitFor();
      await page.getByText("sample.ts", { exact: true }).first().click();
      const editor = page.locator("[data-ide-code-editor] .cm-content");
      await editor.waitFor({ state: "visible", timeout: 120000 });
      assert.match(await editor.innerText(), /const original = 1;/);
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type("const added = 2;");
      await page.locator("[data-ide-dirty-dot]").waitFor({ state: "visible" });
      await page.keyboard.press("ControlOrMeta+s");
      await page.locator("[data-ide-dirty-dot]").waitFor({ state: "detached" });
      assert.equal(await readFile(file, "utf8"), "\ufeffconst original = 1;\r\nconst added = 2;");
      console.log("IDE E2E: saved with BOM/CRLF");
      await checkIdeEditorSwitch({ page });
      // 切主题不得丢掉撤销历史或编辑器 DOM。
      const cursorBefore = await editor.evaluate(() => ({
        anchor: window.getSelection()?.anchorOffset,
        focus: window.getSelection()?.focusOffset,
        text: window.getSelection()?.anchorNode?.textContent,
      }));
      await editor.evaluate((node) => {
        node.dataset.ideEditorIdentity = "original";
        document.documentElement.classList.toggle("dark");
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      assert.deepEqual(
        await editor.evaluate(() => ({
          anchor: window.getSelection()?.anchorOffset,
          focus: window.getSelection()?.focusOffset,
          text: window.getSelection()?.anchorNode?.textContent,
        })),
        cursorBefore,
      );
      await page.keyboard.press("ControlOrMeta+z");
      assert.equal(await editor.getAttribute("data-ide-editor-identity"), "original");
      assert.notEqual(await editor.innerText(), "const original = 1;\nconst added = 2;");
      await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
      await writeFile(file, "external version\n");
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(" changed");
      await page.getByTestId("ide-save").click();
      await page.getByTestId("ide-editor-error").waitFor();
      assert.equal(await readFile(file, "utf8"), "external version\n");
      assert.match(await editor.innerText(), /changed/);
      console.log("IDE E2E: conflict preserved both disk and draft");
      await page.getByTestId("ide-reload").click();
      let dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByRole("button", { name: /取消|Cancel/ }).click();
      assert.match(await editor.innerText(), /changed/);
      await page.getByTestId("ide-reload").click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: /放弃修改|Discard changes/ }).click();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-ide-code-editor] .cm-content")?.textContent ===
          "external version",
      );
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type("unsaved");
      await page.getByRole("button", { name: /返回任务|Back to tasks/ }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: /取消|Cancel/ }).click();
      assert.equal(await toggle.getAttribute("data-interface-mode"), "ide");
      await toggle.click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: /放弃修改|Discard changes/ }).click();
      await page.locator("[data-ide-workbench]").waitFor({ state: "detached" });
      assert.equal(await toggle.getAttribute("data-interface-mode"), previousMode);
      assert.equal(await page.locator('[data-ide-chat-identity="original"]').count(), 1);
      assert.match(
        await page.locator('[data-ide-chat-identity="original"]').innerText(),
        /chat draft preserved/,
      );
      await toggle.click();
      await page.locator("[data-ide-workbench]").waitFor();
      assert.equal(await page.locator("[data-ide-editor-tab]").count(), 0);
      await page.getByText("empty.txt", { exact: true }).first().click();
      await editor.waitFor({ state: "visible" });
      assert.equal((await editor.innerText()).trim(), "");
      const handle = page.getByTestId("ide-chat-resize");
      const rect = await handle.boundingBox();
      assert.ok(rect);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(rect.x + 35, rect.y + rect.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction((before) => {
        const after = document
          .querySelector('[data-testid="ide-chat-resize"]')
          ?.getBoundingClientRect();
        return after && Math.abs(after.x - before) > 10;
      }, rect.x);
      assert.equal(await readFile(file, "utf8"), "external version\n");
      assert.equal(await readFile(join(workspace, "empty.txt"), "utf8"), "");
      await checkIdeEditorCacheEviction({ page });
      await checkIdeSearch({ page, searchFile, reports });
      await checkIdeLinking({ page, file, model, reports });
      await checkComposerEnhancements({ page, model, reports });
      assert.equal(
        errors.filter((error) => /Maximum update depth|Uncaught|IdeEditor|IdeWorkbench/.test(error))
          .length,
        0,
        errors.join("\n"),
      );
      await page.screenshot({ path: join(reports, "passed.png") });
      console.log("IDE E2E: all desktop assertions passed");
    } catch (error) {
      console.error("IDE E2E failed:", error);
      if (app) await writeFile(join(reports, "electron.log"), app.getLog());
      if (page) {
        const details = page.getByRole("button", { name: /展开详情|Show details/ }).first();
        if (await details.isVisible().catch(() => false)) await details.click().catch(() => {});
        await page.screenshot({ path: join(reports, "failed.png"), timeout: 5000 }).catch(() => {});
        await writeFile(
          join(reports, "failed-ui.txt"),
          await page
            .locator("body")
            .innerText()
            .catch(() => ""),
        );
      }
      throw error;
    } finally {
      await writeFile(
        join(reports, "model-requests.json"),
        JSON.stringify(model.requests, null, 2),
      );
      await model.close();
      await app?.close().catch(() => {});
      if (server) {
        server.httpServer.closeAllConnections();
        await new Promise((resolve) => server.httpServer.close(resolve));
      }
      process.chdir(originalCwd);
      if (oldBridge === undefined) delete process.env.VITE_ZCODE_E2E_STORE_BRIDGE;
      else process.env.VITE_ZCODE_E2E_STORE_BRIDGE = oldBridge;
      if (oldTemp === undefined) delete process.env.TEMP;
      else process.env.TEMP = oldTemp;
      if (oldTmp === undefined) delete process.env.TMP;
      else process.env.TMP = oldTmp;
      assert.equal(dirname(resolve(run)), resolve(base));
      await rm(run, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
  },
);

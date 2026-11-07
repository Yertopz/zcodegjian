import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { _electron as electron } from "playwright-core";
import electronPath from "electron";

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 显式运行的 Electron E2E：无模型/凭据，不启动用户的 workspace 或 Host。
// 临时目录预算 32 MiB（含 Chromium profile），退出时回收；复用已安装 Electron，不额外下载。
test("AI 后台浏览器事件保持对话、草稿和焦点，guest 仍可执行", { timeout: 90_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), "zcode-browser-background-e2e-"));
  let app;
  try {
    const bundle = await build({
      entryPoints: [join(uiRoot, "test/support/browserConsoleBackgroundHarness.tsx")],
      outfile: join(scratch, "harness.js"),
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      tsconfig: join(uiRoot, "tsconfig.json"),
      define: { "process.env.NODE_ENV": '"test"', "import.meta": "{}" },
    });
    // 由测试进程写临时文件，避免本机 esbuild 子进程的完整性标签影响写入权限。
    await writeFile(join(scratch, "harness.js"), bundle.outputFiles[0].contents);
    await writeFile(
      join(scratch, "index.html"),
      '<div id="root"></div><script src="harness.js"></script>',
    );
    await writeFile(
      join(scratch, "main.cjs"),
      `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(scratch, "profile"))});
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { webviewTag: true } });
  win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
});`,
    );
    const env = { ...process.env, NO_PROXY: "localhost,127.0.0.1,::1" };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: electronPath,
      args: [join(scratch, "main.cjs")],
      env,
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByTestId("bound").waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="bound"]').textContent === "true",
    );
    const initialTabCount = await page.locator("webview").count();
    const draft = page.getByRole("textbox", { name: "Conversation draft" });
    await draft.fill("keep this draft");
    const emit = (name, payload) =>
      page.evaluate(({ name, payload }) => window.browserBackgroundTest.emit(name, payload), {
        name,
        payload,
      });
    const open = {
      workspaceKey: "/background-test",
      sessionId: "test-session",
      instanceId: "background-test",
      tabId: "ai-tab",
    };
    await emit("open", open);
    await page.waitForFunction(() => {
      const guest = document.querySelector('[data-browser-console-tab="ai-tab"]');
      try {
        return guest?.getWebContentsId() > 0;
      } catch {
        return false;
      }
    });
    const assertChat = async () => {
      assert.equal(await page.getByTestId("view").textContent(), "chat");
      assert.equal(await draft.inputValue(), "keep this draft");
      assert.equal(await draft.evaluate((node) => document.activeElement === node), true);
    };
    await assertChat();

    for (const visible of [true, false, true]) {
      await emit("visibility", {
        workspaceKey: open.workspaceKey,
        sessionId: open.sessionId,
        visible,
      });
      await assertChat();
    }
    const guestId = await page
      .locator('[data-browser-console-tab="ai-tab"]')
      .evaluate((node) => node.getWebContentsId());
    const result = await app.evaluate(async ({ webContents }, guestId) => {
      const guest = webContents.fromId(guestId);
      await guest.loadURL(
        "data:text/html,<input id='field'><button onclick=\"document.title=document.querySelector('input').value\">Save</button>",
      );
      // 真 guest 上走 CDP，与浏览器执行器使用同一类原生命令，验证隐藏并未阻断执行。
      guest.debugger.attach("1.3");
      try {
        return await guest.debugger.sendCommand("Runtime.evaluate", {
          expression:
            "document.querySelector('input').value='background result'; document.querySelector('button').click(); document.title",
          returnByValue: true,
        });
      } finally {
        guest.debugger.detach();
      }
    }, guestId);
    assert.equal(result.result.value, "background result");
    await assertChat();

    await page.getByRole("button", { name: "Open browser", exact: true }).click();
    assert.equal(await page.getByTestId("view").textContent(), "browser");
    await emit("visibility", { sessionId: open.sessionId, visible: false });
    assert.equal(await page.getByTestId("view").textContent(), "browser");
    await page.getByRole("button", { name: "Return to chat" }).click();
    await draft.focus();
    await emit("open", { ...open, workspaceKey: "/another-workspace", tabId: "foreign-tab" });
    assert.equal(await page.locator("webview").count(), initialTabCount + 1);
    await emit("open", open);
    await page.waitForFunction((oldId) => {
      try {
        const id = document.querySelector('[data-browser-console-tab="ai-tab"]').getWebContentsId();
        return id > 0 && id !== oldId;
      } catch {
        return false;
      }
    }, guestId);
    await assertChat();
    assert.deepEqual(errors, []);
  } finally {
    await app?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

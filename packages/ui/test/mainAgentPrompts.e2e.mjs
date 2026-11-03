import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { ContextBuilder } from "../../../apps/zcode-cli/packages/core/src/context/builder.ts";

// 真实 React 设置与选择器 + 生产 ContextBuilder；临时预算 32 MiB，profile/构建产物用后清理。
// 最终 provider 请求与运行中切换另由 core 的真实 AgentRuntime loop 测试覆盖。
test(
  "主提示词 UI：新增、默认、会话选择、模型上下文、失败保留、重载和删除",
  { timeout: 180000 },
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), "zcode-main-prompts-"));
    let app;
    let server;
    try {
      const bundled = await build({
        entryPoints: [resolve("packages/ui/test/support/mainAgentPromptsHarness.tsx")],
        outdir: scratch,
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        tsconfig: resolve("packages/ui/tsconfig.json"),
        define: { "process.env.NODE_ENV": '"test"', "import.meta": '{"url":"file:///fixture/"}' },
        loader: { ".woff2": "empty" },
      });
      for (const file of bundled.outputFiles) await writeFile(file.path, file.contents);
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
      const css = styles.output.find(
        (item) => item.type === "asset" && item.fileName.endsWith(".css"),
      );
      assert.ok(css);
      await writeFile(join(scratch, "app.css"), css.source);
      await writeFile(
        join(scratch, "index.html"),
        '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="mainAgentPromptsHarness.js"></script>',
      );
      server = createServer(async (request, response) => {
        if (request.url === "/system-request") {
          let body = "";
          for await (const chunk of request) body += chunk;
          const context = new ContextBuilder({
            workingDirectory: "/fixture",
            envInfo: {
              cwd: "/fixture",
              platform: "linux",
              shell: "bash",
              osVersion: "fixture",
              nodeVersion: "24",
            },
            mainAgentPrompt: JSON.parse(body),
          }).build();
          response.end(JSON.stringify(context.systemMessages));
          return;
        }
        const name = request.url === "/" ? "index.html" : request.url.slice(1);
        if (!["index.html", "mainAgentPromptsHarness.js", "app.css"].includes(name)) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader(
          "Content-Type",
          name.endsWith(".js")
            ? "text/javascript"
            : name.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
        response.end(await readFile(join(scratch, name)));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const executablePath = process.env.ZCODE_E2E_CHROMIUM_PATH;
      app = await chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        headless: true,
      });
      const page = await app.newPage({ viewport: { width: 1100, height: 1000 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.getByTestId("main-agent-prompts-add").click();
      await page.getByTestId("main-agent-prompt-name").fill("测试角色");
      await page.getByTestId("main-agent-prompt-description").fill("测试简介");
      await page.getByTestId("main-agent-prompt-body").fill("E2E_MAIN_PROMPT_MARKER");
      await page.evaluate(() => window.mainAgentPromptsTest.failSave(true));
      await page.getByTestId("main-agent-prompt-save").click();
      await page.getByRole("alert").filter({ hasText: "保存失败" }).waitFor();
      assert.equal(
        await page.getByTestId("main-agent-prompt-body").inputValue(),
        "E2E_MAIN_PROMPT_MARKER",
      );
      await page.evaluate(() => window.mainAgentPromptsTest.failSave(false));
      await page.getByTestId("main-agent-prompt-save").click();
      await page.getByTestId("main-agent-prompt-save").waitFor({ state: "detached" });
      const id = await page.evaluate(
        () =>
          window.mainAgentPromptsTest
            .settings()
            .mainAgentPrompts.prompts.find((item) => item.name === "测试角色").id,
      );
      await page.getByTestId("main-agent-prompts-default").selectOption(id);
      await page.getByTestId("main-agent-prompt-selector").click();
      await page.getByRole("menuitem").filter({ hasText: "测试角色" }).click();
      await page
        .getByTestId("main-agent-prompt-selector")
        .filter({ hasText: "测试角色" })
        .waitFor();
      await page.getByTestId("fixture-send").click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="fixture-system-request"]')
          .textContent.includes("E2E_MAIN_PROMPT_MARKER"),
      );
      assert.match(
        await page.getByTestId("fixture-system-request").textContent(),
        /E2E_MAIN_PROMPT_MARKER/,
      );
      assert.match(
        await page.getByTestId("fixture-system-request").textContent(),
        /interactive ZCode agent/,
      );
      await page.evaluate(() => window.mainAgentPromptsTest.failSwitch(true));
      await page.getByTestId("main-agent-prompt-selector").click();
      await page.getByRole("menuitem", { name: "默认", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "切换失败" }).waitFor();
      assert.match(await page.getByTestId("main-agent-prompt-selector").textContent(), /测试角色/);
      await page.reload();
      await page
        .getByTestId("main-agent-prompt-selector")
        .filter({ hasText: "测试角色" })
        .waitFor();
      assert.equal(await page.getByTestId("main-agent-prompts-default").inputValue(), id);
      for (const width of [1100, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ["zai-light", "zai-dark"]) {
          await page.evaluate((value) => {
            document.documentElement.className =
              value === "zai-dark" ? "dark theme-zai-dark" : "theme-zai-light";
            document.body.style.setProperty("background", "var(--color-background)", "important");
          }, theme);
          await page.getByTestId("main-agent-prompt-selector").focus();
          await page.keyboard.press("Enter");
          await page.getByRole("menuitem").filter({ hasText: "测试角色" }).waitFor();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.keyboard.press("Escape");
        }
      }
      await page.setViewportSize({ width: 1100, height: 1000 });
      await page.getByTestId("main-agent-prompt-selector").click();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
      await page.screenshot({
        path: resolve(".tmp/main-agent-prompts-preview.png"),
        fullPage: true,
      });
      const row = page
        .locator('[data-testid="main-agent-prompts-settings"] > div')
        .filter({ hasText: "测试简介" })
        .last();
      await row.getByRole("button", { name: "删除", exact: true }).click();
      await page
        .getByTestId("main-agent-prompt-delete-confirm")
        .getByRole("button", { name: /删除/ })
        .click();
      await page.getByTestId("main-agent-prompt-selector").filter({ hasText: "默认" }).waitFor();
      await page.getByTestId("fixture-send").click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-testid="fixture-system-request"]')
            .textContent.includes("E2E_MAIN_PROMPT_MARKER"),
      );
      assert.doesNotMatch(
        await page.getByTestId("fixture-system-request").textContent(),
        /E2E_MAIN_PROMPT_MARKER/,
      );
      await page.reload();
      await page.getByTestId("main-agent-prompts-add").waitFor();
      assert.equal(
        await page.evaluate(
          (promptId) =>
            window.mainAgentPromptsTest
              .settings()
              .mainAgentPrompts.prompts.some((item) => item.id === promptId),
          id,
        ),
        false,
      );
      assert.deepEqual(errors, []);
    } finally {
      await app?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

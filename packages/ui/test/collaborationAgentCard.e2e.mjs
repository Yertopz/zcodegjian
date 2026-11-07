import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("智能体卡片编辑、开关和删除分别触发对应操作", { timeout: 120000 }, async () => {
  const bundle = await build({
    entryPoints: [resolve("packages/ui/test/support/collaborationAgentCardHarness.tsx")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    tsconfig: resolve("packages/ui/tsconfig.json"),
    define: { "process.env.NODE_ENV": '"test"', "import.meta": '{"url":"file:///fixture/"}' },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".woff2": "empty" },
    plugins: [
      {
        name: "intl",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\/i18n\/IntlProvider\.js$/ }, () => ({
            path: "intl",
            namespace: "fixture",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "const labels = {'settings.subagents.model.inherit':'继承主模型','settings.subagents.tools.all':'全部工具'}; export const useZCodeIntl = () => ({intl:{formatMessage:({id})=>labels[id] ?? id},locale:'zh-CN'});",
            loader: "js",
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ZCODE_E2E_CHROMIUM_PATH || undefined,
  });
  let previewCss;
  if (process.env.ZCODE_E2E_CARD_PREVIEW) {
    const desktopRequire = createRequire(resolve("packages/desktop/package.json"));
    const { build: buildStyles } = await import(pathToFileURL(desktopRequire.resolve("vite")).href);
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
    previewCss = styles.output.find(
      (item) => item.type === "asset" && item.fileName.endsWith(".css"),
    )?.source;
    assert.ok(previewCss);
  }
  try {
    for (const width of [1000, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      if (previewCss && width === 1000) {
        await page.addStyleTag({ content: previewCss });
        await page.getByRole("button", { name: /reviewer/ }).waitFor();
        await page.screenshot({ path: process.env.ZCODE_E2E_CARD_PREVIEW });
      }
      const card = page.getByRole("button", { name: /reviewer/ });
      if (width === 390) {
        await card.focus();
        await page.keyboard.press("Enter");
      } else {
        await card.click();
      }
      await page.getByRole("switch").click();
      await page.getByTitle("common.delete").click();
      assert.equal(await page.getByTestId("actions").textContent(), "edit,toggle,delete");
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

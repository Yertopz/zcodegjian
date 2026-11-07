import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

// 真实 Lexical 与 MentionPlugin；目录和其他上下文提供器使用隔离夹具，不访问用户数据或模型。
test("@ Agent 候选可以键盘选择并保留为草稿文本", { timeout: 120000 }, async () => {
  const empty = "() => ({items: [], loading: false, error: null, title: '', emptyText: ''})";
  const stubs = {
    "../i18n/IntlProvider.js":
      "export const useZCodeIntl = () => ({ intl: { formatMessage: ({id}) => id } });",
    "@/hooks/useSubagents.js": `export const useSubagents = () => ({ agents: [{id: 'reviewer', name: 'reviewer', description: 'Code review', path: 'fixture', scope: 'workspace', source: 'user', enabled: true, modelSelection: {providerId: 'fixture', modelId: 'model-a'}}], loading: false, error: null });`,
    "./providers/fileMentionProvider.js": `export const useFileMentionProvider = ${empty};`,
    "./providers/pluginsMentionProvider.js": `export const usePluginsMentionProvider = ${empty};`,
    "./providers/sessionsMentionProvider.js": `export const useSessionsMentionProvider = ${empty};`,
    "./providers/skillsMentionProvider.js": `export const useSkillsMentionProvider = ${empty};`,
    "./providers/whiteboardMentionProvider.js": `export const useWhiteboardMentionProvider = ${empty};`,
  };
  const bundle = await build({
    entryPoints: [resolve("packages/ui/test/support/collaborationMentionHarness.tsx")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    tsconfig: resolve("packages/ui/tsconfig.json"),
    define: { "process.env.NODE_ENV": '"test"', "import.meta": '{"url":"file:///fixture/"}' },
    loader: { ".png": "dataurl", ".svg": "dataurl" },
    plugins: [
      {
        name: "isolated-catalogs",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) =>
            args.importer.endsWith("MentionPlugin.tsx") && stubs[args.path]
              ? { path: args.path, namespace: "fixture" }
              : null,
          );
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: stubs[args.path],
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
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByTestId("input").fill("@review");
      const option = page.getByRole("option", { name: /reviewer/ });
      await option.waitFor();
      assert.match(await option.textContent(), /fixture\/model-a/);
      await page.keyboard.press("Enter");
      await page.getByTestId("markdown").getByText("@reviewer", { exact: false }).waitFor();
      assert.match(await page.getByTestId("markdown").textContent(), /^@reviewer\s/);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("添加菜单选择智能体后只更新草稿", { timeout: 120000 }, async () => {
  const empty = "() => ({items: [], loading: false, error: null, title: '', emptyText: ''})";
  const stubs = {
    "@/hooks/useSubagents.js": `export const useSubagents = () => ({agents:[{id:'reviewer',name:'reviewer',description:'Review',path:'fixture',scope:'workspace',source:'user',enabled:true,modelSelection:{providerId:'fixture',modelId:'model-a'}}],loading:false,error:null});`,
    "@/mentions/providers/fileMentionProvider.js": `export const useFileMentionProvider = ${empty};`,
    "@/mentions/providers/pluginsMentionProvider.js": `export const usePluginsMentionProvider = ${empty};`,
    "@/mentions/providers/sessionsMentionProvider.js": `export const useSessionsMentionProvider = ${empty};`,
    "@/v4/activeTaskProvider.js": "export const useChatViewActiveTaskProvider = () => 'glm';",
    "@/hooks/useSlashCommands.js": "export const useSlashCommands = () => [];",
    "@/i18n/IntlProvider.js":
      "export const useZCodeIntl = () => ({intl:{formatMessage:({id})=>id}});",
    "@/ControlHintTooltip.js": "export const ControlHintTooltip = ({children}) => children;",
  };
  const bundle = await build({
    entryPoints: [resolve("packages/ui/test/support/collaborationActionMenuHarness.tsx")],
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
            args.importer.endsWith("ChatPromptActionMenu.tsx") && stubs[args.path]
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
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "添加" }).click();
    const option = page.getByRole("option", { name: /reviewer/ });
    assert.match(await option.textContent(), /fixture\/model-a/);
    await option.click();
    assert.equal(await page.getByTestId("draft").textContent(), "@reviewer");
  } finally {
    await browser.close();
  }
});

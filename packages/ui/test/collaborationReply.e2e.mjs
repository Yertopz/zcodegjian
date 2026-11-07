import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("子会话消息实时展示，切换和重启不会复用旧回复", { timeout: 120000 }, async () => {
  const stubs = {
    "@/v4/V4ConversationContext.js":
      "export const useV4Conversation = () => ({layer: window.collaborationReplyHarness.layer});",
    "@/i18n/IntlProvider.js":
      "export const useZCodeIntl = () => ({intl:{formatMessage:({id})=>id}});",
    "@/components/ai-elements/message.js":
      "import React from 'react'; export const MessageResponse = ({children}) => React.createElement('div', null, children);",
  };
  const bundle = await build({
    entryPoints: [resolve("packages/ui/test/support/collaborationReplyHarness.tsx")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    tsconfig: resolve("packages/ui/tsconfig.json"),
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "fixture",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) =>
            args.importer.endsWith("ConversationAgentReply.tsx") && stubs[args.path]
              ? { path: args.path, namespace: "fixture" }
              : null,
          );
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: stubs[args.path],
            loader: "js",
            resolveDir: resolve("packages/ui"),
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
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const update = (id, createdAt, text, state = "complete") =>
      page.evaluate(
        ({ id, createdAt, text, state }) => {
          window.collaborationReplyHarness.update(id, [
            {
              kind: "assistantText",
              rowId: 1,
              turnId: "turn",
              createdAt,
              createdAtSeq: 1,
              text,
              state,
            },
          ]);
        },
        { id, createdAt, text, state },
      );
    await update("child-a", 100, "上一轮回复");
    assert.equal(await page.getByTestId("agent-reply-preview").count(), 0);
    await update("child-a", 201, "正在分析", "streaming");
    await page.getByText("正在分析").waitFor();
    await update("child-a", 202, "分析完成");
    await page.getByText("分析完成").waitFor();
    await page.getByRole("button", { name: "chat.collaboration.openConversation" }).click();
    assert.equal(await page.getByTestId("opened").textContent(), "1");
    await page.getByText("切换子会话").click();
    await update("child-b", 100, "另一个旧回复");
    await page.waitForFunction(() => window.collaborationReplyHarness.released.includes("child-a"));
    assert.equal(await page.getByTestId("agent-reply-preview").count(), 0);
    await update("child-b", 201, "另一个回复");
    await page.getByText("另一个回复").waitFor();
    await page.getByText("新一轮").click();
    assert.equal(await page.getByTestId("agent-reply-preview").count(), 0);
    await update("child-b", 401, "新一轮回复");
    await page.getByText("新一轮回复").waitFor();
    await page.getByText("卸载").click();
    await page.waitForFunction(() => window.collaborationReplyHarness.released.includes("child-b"));
  } finally {
    await browser.close();
  }
});

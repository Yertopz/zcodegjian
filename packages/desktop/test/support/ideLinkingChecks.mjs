import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function checkIdeLinking({ page, file, model, reports }) {
  await page.getByTestId("ide-assistant-label").waitFor({ state: "visible" });
  const editor = page.locator("[data-ide-code-editor] .cm-content");
  await page.getByText("sample.ts", { exact: true }).first().click();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" quote snapshot");
  const line = editor.locator(".cm-line").last();
  const bounds = await line.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  const expected = await line.innerText();
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 1, bounds.y + bounds.height / 2, { steps: 12 });
  await page.mouse.up();
  const selectAndAdd = async () => {
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
      button: "right",
    });
    await page.getByRole("menuitem", { name: /添加到对话|Add to chat/ }).click();
    await page.getByTestId("code-comment-attachment").waitFor();
  };
  await selectAndAdd();
  const chat = page.locator('[data-ide-chat-identity="original"]');
  const attachment = page.getByTestId("code-comment-attachment");
  assert.match(await chat.innerText(), /chat draft preserved/);
  assert.equal(
    await chat.evaluate(
      (node) => node.contains(document.activeElement) || node === document.activeElement,
    ),
    true,
  );
  // 使用既有、只在 E2E build 暴露的传输故障 seam；不把模型失败误当作发送失败。
  await page.evaluate(() => {
    window.__zcodeTransportDelayE2E = { commandMs: 0, ackMs: 0, rejectBeforeSend: true };
  });
  await chat.fill("IDE_E2E_FAIL");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__zcodeTransportDelayE2E?.consumed === true);
  await page.waitForFunction(() =>
    document
      .querySelector('[data-ide-chat-identity="original"]')
      ?.textContent?.includes("IDE_E2E_FAIL"),
  );
  assert.equal(await attachment.count(), 1);
  console.log("IDE E2E: selection quote and failed-send recovery passed");
  await attachment.hover();
  await attachment.getByRole("button").click();
  await attachment.waitFor({ state: "detached" });
  await selectAndAdd();
  // 引用仍保留选中时的未保存内容，重载编辑器不会改变已经添加的附件。
  await page.getByTestId("ide-reload").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /放弃修改|Discard changes/ })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-ide-code-editor] .cm-content")?.textContent ===
      "external version",
  );
  await chat.fill("IDE_E2E_MODIFY");
  await page.keyboard.press("Enter");
  // 真实审批仍生效；测试只允许临时工作区中的这一次编辑。
  const allow = page.locator('[data-permission-option-kind="allowOnce"]').first();
  for (let i = 0; i < 60; i++) {
    if ((await readFile(file, "utf8")).includes("agent version")) break;
    if (await allow.isVisible()) await allow.click();
    await page.waitForTimeout(1000);
  }
  assert.equal(await readFile(file, "utf8"), "agent version\n");
  console.log("IDE E2E: real CLI edited the temporary file through the fake model");
  await page.getByText("IDE_E2E_DONE", { exact: false }).first().waitFor({ timeout: 120000 });
  await page.waitForFunction(
    () =>
      document.querySelector("[data-ide-code-editor] .cm-content")?.textContent === "agent version",
  );
  console.log("IDE E2E: clean editor refreshed after the agent edit");
  const firstRequest = model.requests.find(
    (request) =>
      JSON.stringify(request.messages).includes("IDE_E2E_MODIFY") && request.tools?.length,
  );
  assert.ok(firstRequest);
  const requestText = firstRequest.messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : (message.content ?? []).map((part) => part.text ?? "").join("\n"),
    )
    .join("\n");
  assert.match(requestText, /# ZCode IDE Assistant/);
  assert.match(requestText, /Tool: TaskOutput/);
  assert.doesNotMatch(requestText, /# ZCode Universal Main Assistant/);
  const activeContext = /IDE context \(data\):\n([^\n]+)/.exec(requestText);
  assert.ok(activeContext);
  const activeFile = JSON.parse(activeContext[1]).activeFile;
  assert.equal(activeFile.absolutePath.replaceAll("\\", "/"), file.replaceAll("\\", "/"));
  assert.equal(activeFile.hasUnsavedChanges, false);
  assert.doesNotMatch(
    requestText,
    /external version/,
    "active file context must not auto-attach the whole file",
  );
  const quoteBlock = /# Code selections \(v2\):\n([^\n]+)/.exec(requestText);
  assert.ok(quoteBlock, "final provider request must contain the actual selected snapshot");
  const submittedQuote = JSON.parse(quoteBlock[1])[0];
  assert.equal(submittedQuote.selectedText, expected);
  assert.equal(submittedQuote.hasUnsavedChanges, true);
  assert.equal(submittedQuote.startLine, 2);
  assert.equal(submittedQuote.endLine, 2);
  assert.equal(submittedQuote.sourcePath.replaceAll("\\", "/"), file.replaceAll("\\", "/"));
  assert.ok(
    (firstRequest.tools ?? []).every((tool) =>
      [
        "Read",
        "Edit",
        "Write",
        "Bash",
        "Glob",
        "Grep",
        "AskUserQuestion",
        "TaskOutput",
        "TaskStop",
      ].includes(tool.function?.name ?? tool.name),
    ),
  );
  // 聊天链接走真实 MessageFileLink -> WorkspaceShell -> useAppPanels。
  // 草稿提交会创建正式会话；在该会话内，文件跳转不应再重挂聊天编辑器。
  const currentChat = page
    .locator('[data-ide-workbench] [contenteditable="true"]:not(.cm-content)')
    .first();
  await currentChat.evaluate((node) => {
    node.dataset.ideLinkedChat = "stable";
  });
  const link = page
    .locator('[data-ide-workbench] [data-testid="message-file-link"]')
    .filter({ hasText: "linked.ts" })
    .first();
  await link.click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-ide-editor-pane] .cm-content")
      ?.textContent?.includes("export const linked"),
  );
  await page.getByRole("treeitem").filter({ hasText: "linked.ts" }).waitFor({ state: "visible" });
  assert.equal(
    await page
      .getByRole("treeitem")
      .filter({ hasText: /^nested$/ })
      .getAttribute("aria-expanded"),
    "true",
  );
  await page
    .locator("[data-ide-editor-pane] .cm-selectionBackground")
    .first()
    .waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-ide-editor-pane] .cm-content").count(), 1);
  assert.equal(await page.locator('[data-ide-linked-chat="stable"]').count(), 1);
  console.log("IDE E2E: file link, tree reveal and line highlight passed");
  // 摘要按钮的无障碍名称是“展开”，文件数量是按钮内的可见文字。
  const summary = page
    .getByRole("button")
    .filter({ hasText: /1.*文件.*更改|1 file changed/i })
    .first();
  await summary.click();
  await page.locator(`[role="button"][title]`).filter({ hasText: "sample.ts" }).last().click();
  const preview = page.locator("[data-ide-editor-pane]");
  await preview.getByText("external version", { exact: false }).first().waitFor();
  await preview.getByText("agent version", { exact: false }).first().waitFor();
  await page
    .locator("[data-ide-editor-pane]")
    .getByRole("button", { name: /查看源码|View source/ })
    .click();
  await editor.waitFor();
  assert.match(await editor.innerText(), /agent version/);
  assert.equal(await page.locator('[data-workspace-side-frame][aria-hidden="false"]').count(), 0);
  await page.screenshot({ path: `${reports}/linking-passed.png` });

  // IDE 是主对话的执行配置；辅助对话必须能选择并真正使用自己的提示词。
  await page.getByTestId("side-pane-toggle").first().click();
  const side = page.locator('[data-workspace-side-frame][aria-hidden="false"]');
  const launcher = side.locator('[data-side-pane-open-tab-item="selection-side-conversation"]');
  if (await launcher.isVisible()) {
    await launcher.click();
  } else {
    await side.locator("[data-side-pane-add-tab-trigger]").click();
    await page.locator('[data-side-pane-add-item="selection-side-conversation"]').click();
  }
  const selector = side.getByTestId("main-agent-prompt-selector");
  await selector.waitFor({ timeout: 60000 });
  assert.equal(await side.getByTestId("ide-assistant-label").count(), 0);
  await selector.click();
  await page.getByRole("menuitem").filter({ hasText: "精简回答" }).click();
  await selector.filter({ hasText: "精简回答" }).waitFor();
  const sideInput = side.locator('[contenteditable="true"]:not(.cm-content)');
  await sideInput.fill("IDE_E2E_AUXILIARY");
  await sideInput.press("Enter");
  await side.getByText("IDE_E2E_DONE", { exact: false }).first().waitFor({ timeout: 120000 });
  const auxiliaryRequest = model.requests.find(
    (request) =>
      request.tools?.length && JSON.stringify(request.messages).includes("IDE_E2E_AUXILIARY"),
  );
  assert.ok(auxiliaryRequest);
  const system = auxiliaryRequest.messages
    .filter((message) => message.role === "system")
    .map((message) => JSON.stringify(message.content))
    .join("\n");
  assert.match(system, /回答先给结论/);
  assert.match(system, /# ZCode Universal Main Assistant/);
  assert.doesNotMatch(system, /# ZCode IDE Assistant|IDE context \(data\)/);
  assert.equal(
    await page.locator("[data-ide-workbench]").getByTestId("ide-assistant-label").count(),
    1,
  );
  assert.equal(await selector.filter({ hasText: "精简回答" }).count(), 1);
  await sideInput.fill("auxiliary draft preserved");
  await side.getByTestId("side-pane-toggle").click();
  await page.getByTestId("side-pane-toggle").first().click();
  await selector.filter({ hasText: "精简回答" }).waitFor();
  assert.equal(await sideInput.innerText(), "auxiliary draft preserved");
  await page.screenshot({ path: `${reports}/auxiliary-passed.png` });
  console.log("IDE E2E: auxiliary prompt selection and real provider request passed");
}

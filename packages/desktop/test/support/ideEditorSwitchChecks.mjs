import assert from "node:assert/strict";

function sourceTab(page, name) {
  return page.locator("[data-ide-editor-tab]").filter({ hasText: name }).first();
}

function editorContent(page) {
  return page.locator("[data-ide-code-editor] .cm-content");
}

async function waitForEditorText(page, expected) {
  await page.waitForFunction(
    (text) => document.querySelector("[data-ide-code-editor] .cm-content")?.textContent === text,
    expected,
    { timeout: 10000 },
  );
}

async function selectionInEditor(editor) {
  return editor.evaluate((node) => {
    const selection = window.getSelection();
    if (
      !selection?.anchorNode ||
      !selection.focusNode ||
      !node.contains(selection.anchorNode) ||
      !node.contains(selection.focusNode)
    )
      return null;
    const offset = (target, position) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.setEnd(target, position);
      return range.toString().length;
    };
    // 语言加载可重新拆分高亮节点；比较文档内逻辑位置，不比较临时 token DOM。
    return {
      anchor: offset(selection.anchorNode, selection.anchorOffset),
      focus: offset(selection.focusNode, selection.focusOffset),
      text: selection.toString(),
    };
  });
}

export async function checkIdeEditorSwitch({ page }) {
  const editor = editorContent(page);
  const originalText = await editor.textContent();
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+Home");
  for (let index = 0; index < 5; index++) await page.keyboard.press("Shift+ArrowRight");
  const originalSelection = await selectionInEditor(editor);
  assert.equal(originalSelection?.text, "const");
  // 先加载两个标签；首次读取文件的 loading 占位和只读预览允许卸载视图。
  await page.getByText("empty.txt", { exact: true }).first().click();
  await waitForEditorText(page, "");
  await sourceTab(page, "sample.ts").click();
  await waitForEditorText(page, originalText);
  await editor.focus();
  assert.deepEqual(await selectionInEditor(editor), originalSelection);
  // 标记真实 CodeMirror 根节点；单纯复用 React 外壳不能使此断言通过。
  await page.locator(".cm-editor").evaluate((node) => {
    node.dataset.ideSwitchIdentity = "single-view";
  });
  await sourceTab(page, "empty.txt").click();
  await waitForEditorText(page, "");
  await editor.focus();
  await page.keyboard.insertText("independent draft");
  await sourceTab(page, "sample.ts").click();
  await waitForEditorText(page, originalText);
  await editor.focus();
  assert.deepEqual(await selectionInEditor(editor), originalSelection);
  assert.equal(await page.locator('[data-ide-switch-identity="single-view"]').count(), 1);
  assert.equal(await page.locator(".cm-editor").count(), 1);
  // 返回文件后仍能撤销原来的输入，且不会撤销另一个文件的草稿。
  await page.keyboard.press("ControlOrMeta+z");
  assert.notEqual(await editor.textContent(), originalText);
  // CodeMirror 在 Windows/Linux 的重做键为 Ctrl+Y，macOS 才是 Cmd+Shift+Z。
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
  await waitForEditorText(page, originalText);
  await sourceTab(page, "empty.txt").click();
  await waitForEditorText(page, "independent draft");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await waitForEditorText(page, "");
  await sourceTab(page, "sample.ts").click();
  await waitForEditorText(page, originalText);
  await editor.focus();
  console.log("IDE E2E: one EditorView, per-file selection and undo preserved");
}

export async function checkIdeEditorCacheEviction({ page }) {
  const editor = editorContent(page);
  await editor.focus();
  await page.keyboard.insertText("draft survives eviction");
  // 超过非活动缓存容量，仍必须从 store 恢复草稿；不把所有标签常驻为隐藏 DOM。
  for (let index = 0; index < 6; index++) {
    await page.getByText(`cache-${index}.ts`, { exact: true }).first().click();
    await waitForEditorText(page, `export const cache = ${index};`);
    assert.equal(await page.locator(".cm-editor").count(), 1);
  }
  await sourceTab(page, "empty.txt").click();
  await waitForEditorText(page, "draft survives eviction");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  assert.equal(await editor.textContent(), "draft survives eviction");
  await page.getByTestId("ide-reload").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /放弃修改|Discard changes/ })
    .click();
  await waitForEditorText(page, "");
  await sourceTab(page, "cache-0.ts").click();
  await waitForEditorText(page, "export const cache = 0;");
  await sourceTab(page, "empty.txt").click();
  await waitForEditorText(page, "");
  console.log("IDE E2E: evicted draft restored and explicit reload invalidated old state");
  await page.getByText("scroll.ts", { exact: true }).first().click();
  const scroller = page.locator("[data-ide-code-editor] .cm-scroller");
  await scroller.waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document
      .querySelector("[data-ide-code-editor] .cm-content")
      ?.textContent?.startsWith("// line 0 "),
  );
  await scroller.evaluate(async (node) => {
    node.scrollTop = 600;
    node.scrollLeft = 240;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const scroll = await scroller.evaluate((node) => ({
    top: node.scrollTop,
    left: node.scrollLeft,
  }));
  assert.ok(scroll.top > 100 && scroll.left > 50);
  await sourceTab(page, "cache-0.ts").click();
  await waitForEditorText(page, "export const cache = 0;");
  await sourceTab(page, "scroll.ts").click();
  await page.waitForFunction(({ top, left }) => {
    const node = document.querySelector("[data-ide-code-editor] .cm-scroller");
    return node && Math.abs(node.scrollTop - top) < 2 && Math.abs(node.scrollLeft - left) < 2;
  }, scroll);
  // 关闭后重新打开同一路径使用新实例，旧的滚动位置不能复活。
  await sourceTab(page, "scroll.ts")
    .locator("..")
    .getByRole("button", { name: /关闭|Close/ })
    .click();
  await sourceTab(page, "scroll.ts").waitFor({ state: "detached" });
  await page.getByText("scroll.ts", { exact: true }).first().click();
  await scroller.waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document
      .querySelector("[data-ide-code-editor] .cm-content")
      ?.textContent?.startsWith("// line 0 "),
  );
  await page.waitForFunction(
    () => document.querySelector("[data-ide-code-editor] .cm-scroller")?.scrollTop === 0,
  );
  console.log("IDE E2E: cached scroll restored and closed tab state released");
}

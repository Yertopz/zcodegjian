import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TID_IDE_TEXT_SEARCH_INPUT,
  TID_IDE_TEXT_SEARCH_CASE,
  TID_IDE_FILES_TAB,
} from "@zcode/shared";

/** 真实 Host/FileService 搜索临时工作区，不替换搜索返回值。 */
export async function checkIdeSearch({ page, searchFile, reports }) {
  const editor = page.locator("[data-ide-code-editor] .cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Shift+f");
  const input = page.getByTestId(TID_IDE_TEXT_SEARCH_INPUT);
  await input.waitFor({ state: "visible" });
  assert.equal(await input.evaluate((node) => node === document.activeElement), true);
  await input.fill("IDE_SEARCH_文本");
  await input.press("Enter");
  const results = page.locator("[data-ide-search-result]");
  await results.nth(1).waitFor();
  assert.equal(await results.count(), 2);
  assert.equal(await results.first().getAttribute("data-line"), "2");
  assert.equal(await results.first().getAttribute("data-path"), searchFile);
  await page.getByTestId(TID_IDE_TEXT_SEARCH_CASE).click();
  await input.press("Enter");
  await results.first().waitFor();
  assert.equal(await results.count(), 1);
  await results.first().click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-ide-code-editor] .cm-content")
      ?.textContent?.includes("IDE_SEARCH_文本"),
  );
  const highlight = page.locator("[data-ide-code-editor] .cm-selectionBackground").first();
  await highlight.waitFor({ state: "visible" });
  const selectedLine = await editor.locator(".cm-line").nth(1).boundingBox();
  const selection = await highlight.boundingBox();
  assert.ok(Math.abs(selectedLine.y - selection.y) < 3, "search result must highlight line 2");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" // unsaved-search");
  await page.locator("[data-ide-dirty-dot]").waitFor();
  await results.first().click();
  assert.match(await editor.innerText(), /unsaved-search/);
  assert.doesNotMatch(await readFile(searchFile, "utf8"), /unsaved-search/);
  assert.equal(await page.locator('[data-ide-chat-identity="original"]').count(), 1);
  assert.match(
    await page.locator('[data-ide-chat-identity="original"]').innerText(),
    /chat draft preserved/,
  );
  assert.equal(await page.locator('[data-workspace-side-frame][aria-hidden="false"]').count(), 0);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+s");
  await page.locator("[data-ide-dirty-dot]").waitFor({ state: "detached" });
  await page.screenshot({ path: `${reports}/search-passed.png` });
  await input.fill("IDE_SEARCH_NO_MATCH");
  await input.press("Enter");
  await page.getByText(/未找到匹配文本|No matching text/).waitFor();
  assert.equal(await results.count(), 0);
  await page.getByTestId(TID_IDE_FILES_TAB).click();
  await page
    .getByRole("treeitem")
    .filter({ hasText: "search-target.ts" })
    .waitFor({ state: "visible" });
  console.log(
    "IDE E2E: global text search, case, line navigation, dirty draft and stable chat passed",
  );
}

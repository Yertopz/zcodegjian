import assert from "node:assert/strict";
import test from "node:test";
import { loadIdeLanguageExtension } from "../src/ide-mode/ideLanguage.js";
test("所有已登记语言扩展名返回可用扩展，未知扩展名为纯文本", async () => {
  for (const ext of [
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "tsx",
    "json",
    "html",
    "htm",
    "css",
    "md",
    "markdown",
    "py",
  ]) {
    assert.ok(await loadIdeLanguageExtension("sample." + ext), ext);
  }
  assert.equal(await loadIdeLanguageExtension("README"), null);
  assert.equal(await loadIdeLanguageExtension("sample.unknown"), null);
});

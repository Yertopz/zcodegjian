import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPromptWithCodeComments,
  parsePromptCodeComments,
} from "../src/lib/codeCommentContext.js";

test("IDE quote preserves selection bytes, paths and dirty state through serialization", () => {
  const selectedText = "\r\n  const template = `a`;\r\n```\r\n## Comment 2\r\n\t\r\n";
  const quote = {
    id: "q",
    workspacePath: "C:/project",
    sourcePath: "C:/project/a.ts",
    sourceTitle: "a.ts",
    startLine: 3,
    endLine: 9,
    selectedText,
    comment: "",
    hasUnsavedChanges: true,
  };
  const result = parsePromptCodeComments(buildPromptWithCodeComments("explain", [quote]), {
    workspacePath: quote.workspacePath,
  });
  assert.equal(result.visibleContent, "explain");
  assert.equal(result.codeCommentAttachments[0]?.selectedText, selectedText);
  assert.equal(result.codeCommentAttachments[0]?.hasUnsavedChanges, true);
  assert.equal(result.codeCommentAttachments[0]?.sourcePath, quote.sourcePath);
});

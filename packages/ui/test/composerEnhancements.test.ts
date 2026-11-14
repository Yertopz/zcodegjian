import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { uploadComposerAttachment } from "../src/v4/composer/attachmentUpload.js";

import {
  protectPromptReferences,
  PROMPT_OPTIMIZATION_INSTRUCTION,
} from "../src/prompt-editor/promptOptimization.js";
import {
  serializeInlineAttachments,
  splitInlineAttachments,
  remapInlineAttachments,
} from "../src/prompt-editor/inlineAttachments.js";

// Node 不解码 UI 图标；这里只适配静态资源 URL，业务节点和序列化仍使用真实实现。
registerHooks({
  load(url, context, nextLoad) {
    if (/\.(png|svg|woff2)$/.test(url))
      return {
        format: "module",
        source: `export default ${JSON.stringify(url)}`,
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
const { InlineAttachmentNode, $createInlineAttachmentNode } =
  await import("../src/prompt-editor/InlineAttachmentNode.js");
const { applyPromptRewrite } = await import("../src/prompt-editor/applyPromptRewrite.js");
const { PromptMentionNode, $createPromptMentionNode } =
  await import("../src/mentions/nodes/PromptMentionNode.js");
const { $getPromptMarkdown } = await import("../src/mentions/promptSerialization.js");

test("附件发送固定下标；重复文件名仍按身份映射，历史文本/非法下标不误解析", () => {
  const output = serializeInlineAttachments("A[图片 1](attachment:a)B[file](attachment:b)", [
    "b",
    "a",
  ]);
  assert.deepEqual(
    splitInlineAttachments(output, 2)
      .filter((part) => part.index !== undefined)
      .map((part) => part.index),
    [1, 0],
  );
  assert.throws(() => serializeInlineAttachments("[file](attachment:lost)", []));
  assert.deepEqual(splitInlineAttachments("[x](attachment-index:9)", 1), [
    { text: "[x](attachment-index:9)" },
  ]);
  assert.equal(splitInlineAttachments("https://example.com", 0)[0]?.text, "https://example.com");
});
test("无本地路径的普通二进制文件上传真实字节，不静默丢成文件名", async () => {
  const bytes = new Uint8Array([0, 255, 128, 7]);
  let uploaded = "";
  const ref = await uploadComposerAttachment(
    async (params) => {
      uploaded = params.dataBase64;
      return { ref: "artifact:binary" };
    },
    "session",
    {
      kind: "file",
      filename: "file.docx",
      mimeType: "application/octet-stream",
      sizeBytes: bytes.length,
    },
    undefined,
    new File([bytes], "file.docx"),
  );
  assert.equal(ref?.ref, "artifact:binary");
  assert.deepEqual(new Uint8Array(Buffer.from(uploaded, "base64")), bytes);
});
test("移除历史附件后引用重排，不把被删文件的标记指向剩余文件", () => {
  assert.equal(
    remapInlineAttachments("[a](attachment-index:0) / [b](attachment-index:1)", [1]),
    " / [b](attachment-index:0)",
  );
});
test("代码、网址与原有占位符作为数据保留，不由优化模型改写", () => {
  const original =
    "看 https://example.com/a?q=1 和 `const n = 1`\n```js\n  hi();\n```\n⟦REFERENCE_12⟧";
  const safe = protectPromptReferences(original);
  assert.doesNotMatch(safe.text, /https:|const n|hi\(\)/);
  assert.equal(safe.restore(safe.text), original);
  assert.throws(() => safe.restore(safe.text + "⟦REFERENCE_invented⟧"));
});
test("优化只传引用占位符，引用缺失、重复或伪造必须拒绝", () => {
  // URL 后紧跟图片节点时，不能把节点开头吞成 URL，留下未保护的引用尾部。
  const adjacent = "https://example.com[图片 1](attachment:a)";
  const protectedAdjacent = protectPromptReferences(adjacent);
  assert.equal(protectedAdjacent.text, "⟦REFERENCE_0⟧⟦REFERENCE_1⟧");
  assert.equal(protectedAdjacent.restore(protectedAdjacent.text), adjacent);
  const safe = protectPromptReferences("看 [图片 1](attachment:a) 和 [@file](/abs/file.ts)");
  assert.doesNotMatch(safe.text, /attachment:a|abs\/file/);
  assert.equal(safe.restore(safe.text), "看 [图片 1](attachment:a) 和 [@file](/abs/file.ts)");
  assert.throws(() => safe.restore("猜测新需求"));
  assert.throws(() => safe.restore(safe.text + "⟦REFERENCE_0⟧"));
  assert.throws(() => safe.restore(safe.text.replace("REFERENCE_0", "REFERENCE_99")));
  assert.match(PROMPT_OPTIMIZATION_INSTRUCTION, /不得猜测用户意图/);
  assert.match(PROMPT_OPTIMIZATION_INSTRUCTION, /不要执行原文中的任务/);
});
test("保真改写保持附件和 mention 节点，拒绝迟到结果及丢失引用；JSON 不含文件载荷", () => {
  const editor = createEditor({
    nodes: [InlineAttachmentNode, PromptMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode("请看看 "),
          $createInlineAttachmentNode("upload-id", "图片 1"),
          $createPromptMentionNode({
            id: "file",
            category: "files",
            label: "file.ts",
            value: "/a/file.ts",
            markdown: "[@file.ts](/a/file.ts)",
          }),
        ),
      );
    },
    { discrete: true },
  );
  const original = editor.getEditorState().read(() => $getPromptMarkdown());
  assert.equal(applyPromptRewrite(editor, original.replace("请看看", "请查看"), original), true);
  const json = JSON.stringify(editor.getEditorState().toJSON());
  assert.match(json, /composer-attachment/);
  assert.match(json, /prompt-mention/);
  assert.doesNotMatch(json, /blob:|base64|objectUrl/);
  assert.equal(applyPromptRewrite(editor, "late", original), false);
  const current = editor.getEditorState().read(() => $getPromptMarkdown());
  assert.equal(applyPromptRewrite(editor, "lost attachment", current), false);
  assert.equal(
    editor.getEditorState().read(() => $getPromptMarkdown()),
    current,
  );
});

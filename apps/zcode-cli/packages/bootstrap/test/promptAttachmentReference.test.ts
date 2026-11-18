import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  resolvePersistedPromptAttachment,
  decodePromptAttachmentDataUrl,
} from "../src/app/prompt-attachment-reference.js";

test("通用附件解码保留文本和二进制字节；非法编码与超限仍拒绝", () => {
  for (const mime of ["text/plain", "application/octet-stream", "image/png"]) {
    const bytes = Buffer.from([0, 255, 128, 7]);
    const decoded = decodePromptAttachmentDataUrl(
      `data:${mime};base64,${bytes.toString("base64")}`,
      mime,
      bytes.length,
    );
    assert.deepEqual(decoded.bytes, bytes);
    assert.equal(decoded.mediaType, mime);
  }
  assert.throws(() =>
    decodePromptAttachmentDataUrl("data:text/plain;base64,%%%", "text/plain", 10),
  );
  assert.throws(() =>
    decodePromptAttachmentDataUrl("data:text/plain;base64,YWI=", "text/plain", 1),
  );
});

test("上传文档的展示文件名不能替换已授权 artifact；文本和二进制文件均保留内容引用", () => {
  for (const filename of ["notes.txt", "sample.docx"]) {
    assert.deepEqual(
      resolvePersistedPromptAttachment(
        { ref: "zcode-artifact://session/upload", mime: "application/octet-stream" },
        { url: filename, mime: "text/plain" },
      ),
      {
        ref: "zcode-artifact://session/upload",
        artifactUri: "zcode-artifact://session/upload",
        mediaType: "text/plain",
      },
    );
  }
});

test("消息不可变副本优先于原生路径；无副本时保留绝对路径及尚未落库的授权引用", () => {
  const path = resolve("attachment.txt");
  const input = { ref: path, mime: "text/plain" };
  assert.deepEqual(
    resolvePersistedPromptAttachment(input, {
      url: path,
      mime: "text/plain",
      metadata: { artifactUri: "zcode-artifact://session/snapshot" },
    }),
    {
      ref: "zcode-artifact://session/snapshot",
      artifactUri: "zcode-artifact://session/snapshot",
      mediaType: "text/plain",
    },
  );
  assert.deepEqual(resolvePersistedPromptAttachment(input, { url: path, mime: input.mime }), {
    ref: path,
    mediaType: "text/plain",
  });
  assert.deepEqual(resolvePersistedPromptAttachment(input), {
    ref: path,
    mediaType: "text/plain",
  });
  assert.equal(
    resolvePersistedPromptAttachment(input, {
      url: "data:text/plain;base64,YQ==",
      mime: input.mime,
    }).ref,
    path,
  );
});

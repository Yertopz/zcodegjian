import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { selectAgentReplyPreview } from "../src/v4/collaborationReplyPreview.js";

function assistant(
  rowId: number,
  createdAt: number,
  text: string,
  state: "complete" | "streaming" | "interrupted" = "complete",
): ConversationRow {
  return {
    kind: "assistantText",
    rowId,
    turnId: "turn",
    createdAt,
    createdAtSeq: rowId,
    text,
    state,
  };
}

test("仅选择本次运行之后的最新可见智能体正文", () => {
  const rows = [
    assistant(1, 100, "旧回复"),
    assistant(2, 201, "开始处理"),
    assistant(3, 202, "新回复", "streaming"),
  ];
  assert.deepEqual(selectAgentReplyPreview(rows, 200), { text: "新回复", streaming: true });
  assert.equal(selectAgentReplyPreview(rows, 202), null);
  assert.equal(selectAgentReplyPreview(rows, undefined), null);
});

test("取消或空白正文不会冒充智能体回复", () => {
  assert.equal(
    selectAgentReplyPreview(
      [assistant(1, 201, "   "), assistant(2, 202, "取消的内容", "interrupted")],
      200,
    ),
    null,
  );
  assert.deepEqual(selectAgentReplyPreview([assistant(1, 201, "完成")], 200), {
    text: "完成",
    streaming: false,
  });
});

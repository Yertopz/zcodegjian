import assert from "node:assert/strict";
import test from "node:test";
import type {
  AssistantTextRow,
  ConversationRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";
import { buildConversationTurnWorkSegments } from "../src/v4/conversationTurnWorkSegments.js";

function userInput(rowId: number): UserInputRow {
  return {
    kind: "userInput",
    rowId,
    turnId: "turn",
    createdAt: 100 + rowId,
    createdAtSeq: rowId,
    text: "@frontend-auditor 回复 你好",
    origin: "realUser",
    state: "accepted",
  };
}

function subagent(rowId: number): ConversationRow {
  return {
    kind: "subagent",
    rowId,
    turnId: "turn",
    createdAt: 100 + rowId,
    createdAtSeq: rowId,
    subagentType: "frontend-auditor",
    agentKind: "team",
    status: "success",
    summaryText: "",
    childSessionId: "child-1",
  };
}

function assistant(rowId: number, text: string): AssistantTextRow {
  return {
    kind: "assistantText",
    rowId,
    turnId: "turn",
    createdAt: 100 + rowId,
    createdAtSeq: rowId,
    text,
    state: "complete",
  };
}

function segment(options: { visibleWorkRowIds?: ReadonlySet<number> }) {
  const rows: ConversationRow[] = [userInput(1), subagent(2), assistant(3, "它已就绪，只读。")];
  const [first] = buildConversationTurnWorkSegments({
    key: "turn",
    orderedRows: rows,
    assistantTailRows: [],
    latestAssistantTextRow: rows[2] as AssistantTextRow,
    isRunning: false,
    isLastTurn: false,
    isInterrupted: false,
    forceOpenHistory: false,
    timelineOnly: false,
    ...options,
  });
  assert.ok(first);
  return first;
}

test("成员回复行默认被并进「已工作」折叠的历史集合", () => {
  const built = segment({});
  assert.deepEqual(
    built.assistantHistoryRows.map((row) => row.rowId),
    [2],
  );
  assert.deepEqual(
    built.flowItems.map((item) => item.kind),
    ["userInput", "assistantHistory", "assistantText"],
  );
});

test("点名常显的成员回复行不进历史集合，改由常显 work 流原位渲染", () => {
  const built = segment({ visibleWorkRowIds: new Set([2]) });
  assert.deepEqual(built.assistantHistoryRows, []);
  assert.deepEqual(
    built.flowItems.map((item) => item.kind),
    ["userInput", "assistantWork", "assistantText"],
  );
  const workItem = built.flowItems.find((item) => item.kind === "assistantWork");
  assert.deepEqual(
    workItem?.kind === "assistantWork" ? workItem.rows.map((row) => row.rowId) : null,
    [2],
  );
});

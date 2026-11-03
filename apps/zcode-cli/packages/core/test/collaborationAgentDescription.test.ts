import assert from "node:assert/strict";
import test from "node:test";
import { createAgentToolEntry, createTaskToolEntry } from "../src/tool/handlers/agent.js";
import { resolveSubagentSelection } from "../src/runtime/helpers/subagent-selection.js";

test("Agent 和兼容 Task 工具向模型解释点名及委派边界", () => {
  for (const entry of [createAgentToolEntry(), createTaskToolEntry()]) {
    const description = entry.metadata.description ?? "";
    assert.match(description, /@name/);
    assert.match(description, /subagent_type/);
    assert.match(description, /does not by itself request delegation/);
    assert.match(description, /permission/);
  }
});

test("协作使用智能体已有模型，未配置时继承主模型", () => {
  const parentSelection = { providerId: "parent-provider", modelId: "parent-model" };
  const profileSelection = { providerId: "agent-provider", modelId: "agent-model" };
  assert.deepEqual(
    resolveSubagentSelection({ profileSelection, parentSelection }).selection,
    profileSelection,
  );
  assert.deepEqual(resolveSubagentSelection({ parentSelection }).selection, parentSelection);
  assert.throws(
    () =>
      resolveSubagentSelection({
        profileSelection,
        parentSelection,
        resolveSelection: () => ({
          effectiveSelection: null,
          selectionIssue: "provider-not-found",
        }),
      }),
    /provider-not-found/,
  );
});

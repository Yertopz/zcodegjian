import assert from "node:assert/strict";
import test from "node:test";
import { getMentionPanelGroupOrder } from "../src/mentions/mentionPanelRouting.js";
import { filterMentionItemsWithOptions } from "../src/mentions/mentionSearch.js";
import { mapSubagentsToMentionItemsForTest } from "../src/mentions/providers/subagentsMentionProvider.js";

test("@ 面板包含 Agent，其他触发器保持原有范围", () => {
  assert.deepEqual(getMentionPanelGroupOrder("@"), [
    "subagents",
    "plugins",
    "files",
    "sessions",
    "whiteboards",
  ]);
  assert.deepEqual(getMentionPanelGroupOrder("#"), ["sessions"]);
  assert.deepEqual(getMentionPanelGroupOrder("$"), ["skills"]);
});

test("Agent 搜索只提供已启用项，同名优先工作区，并沿用 @ 文本", () => {
  const agents = [
    {
      id: "u",
      name: "reviewer",
      description: "review",
      path: "user",
      scope: "user",
      source: "user",
      enabled: true,
      modelSelection: null,
    },
    {
      id: "w",
      name: "reviewer",
      description: "review code",
      path: "workspace",
      scope: "workspace",
      source: "user",
      enabled: true,
      modelSelection: { providerId: "example", modelId: "model-a" },
    },
    {
      id: "off",
      name: "disabled",
      description: "",
      path: "off",
      scope: "user",
      source: "user",
      enabled: false,
      modelSelection: null,
    },
  ] as Parameters<typeof mapSubagentsToMentionItemsForTest>[0];
  const items = mapSubagentsToMentionItemsForTest(agents);
  assert.deepEqual(
    items.map((item) => item.id),
    ["subagent:w"],
  );
  assert.equal(items[0]?.markdown, "@reviewer");
  assert.match(items[0]?.description ?? "", /example\/model-a/);
  assert.equal(filterMentionItemsWithOptions(items, "model-a")[0]?.id, "subagent:w");
  assert.equal(filterMentionItemsWithOptions(items, "disabled").length, 0);
});

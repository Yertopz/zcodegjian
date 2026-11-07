import assert from "node:assert/strict";
import test from "node:test";
import { getMentionPanelGroupOrder } from "../src/mentions/mentionPanelRouting.js";
import { filterMentionItemsWithOptions } from "../src/mentions/mentionSearch.js";
import { mapAllAgentsToMentionItems } from "../src/mentions/agentMentions.js";
import {
  mapAgentsToMentionItems,
  type AgentMentionInput,
} from "../src/mentions/providers/agentsMentionProvider.js";
import { mapTeamMembersToMentionItems } from "../src/mentions/providers/teamMembersMentionProvider.js";

const baseAgent = {
  path: "user",
  scope: "user",
  source: "user",
  enabled: true,
  modelSelection: null,
} as const;

function agent(
  overrides: Partial<AgentMentionInput> & { id: string; name: string },
): AgentMentionInput {
  return { ...baseAgent, description: "", ...overrides } as AgentMentionInput;
}

test("@ 面板包含 Agent 分组；团队模式下团队成员单独置顶", () => {
  assert.deepEqual(getMentionPanelGroupOrder("@"), [
    "subagents",
    "plugins",
    "files",
    "sessions",
    "whiteboards",
  ]);
  assert.deepEqual(getMentionPanelGroupOrder("@", { teamMode: true }), [
    "teamMembers",
    "subagents",
    "plugins",
    "files",
    "sessions",
    "whiteboards",
  ]);
  // 其他触发器的范围不受多智能体模式影响。
  assert.deepEqual(getMentionPanelGroupOrder("#"), ["sessions"]);
  assert.deepEqual(getMentionPanelGroupOrder("$"), ["skills"]);
});

test("子智能体分组排除团队成员，只提供已启用项，同名优先工作区", () => {
  const items = mapAgentsToMentionItems([
    agent({ id: "u", name: "reviewer", description: "review" }),
    agent({
      id: "w",
      name: "reviewer",
      description: "review code",
      path: "workspace",
      scope: "workspace",
      modelSelection: { providerId: "example", modelId: "model-a" },
    }),
    agent({ id: "off", name: "disabled", enabled: false }),
    agent({ id: "team", name: "frontend-auditor", kind: "team" }),
  ]);
  assert.deepEqual(
    items.map((item) => item.id),
    ["subagent:w"],
  );
  assert.equal(items[0]?.markdown, "@reviewer");
  assert.match(items[0]?.description ?? "", /example\/model-a/);
  assert.equal(filterMentionItemsWithOptions(items, "model-a")[0]?.id, "subagent:w");
  assert.equal(filterMentionItemsWithOptions(items, "frontend-auditor").length, 0);
});

test("团队成员分组只含 kind === team 的成员，并携带颜色与头像", () => {
  const agents = [
    agent({ id: "team", name: "frontend-auditor", description: "审计前端", kind: "team" }),
    agent({
      id: "team2",
      name: "backend-auditor",
      kind: "team",
      color: "purple",
      avatar: { kind: "emoji", value: "🦊" },
    }),
    agent({ id: "u", name: "reviewer", description: "review" }),
  ];
  const members = mapTeamMembersToMentionItems(agents);
  assert.deepEqual(
    members.map((item) => item.id),
    ["team-member:team", "team-member:team2"],
  );
  assert.equal(members[0]?.data?.agentKind, "team");
  assert.match(members[0]?.description ?? "", /^多智能体 · /);
  assert.equal(members[1]?.data?.agentColor, "purple");
  assert.deepEqual(members[1]?.data?.agentAvatar, { kind: "emoji", value: "🦊" });
  assert.equal(members[1]?.markdown, "@backend-auditor");
});

test("合并列表里成员排在前面，同名不重复出现", () => {
  const agents = [
    agent({ id: "u", name: "reviewer", description: "普通子智能体" }),
    agent({ id: "team", name: "reviewer", kind: "team", description: "团队成员" }),
  ];
  const merged = mapAllAgentsToMentionItems(agents);
  assert.deepEqual(
    merged.map((item) => item.id),
    ["team-member:team"],
  );
});

test("多智能体模式下内置 Explore 不再列出，非团队模式照常可 @", () => {
  const builtInExplore = agent({
    id: "explore",
    name: "Explore",
    path: "builtin",
    source: "built-in",
  });
  const generalPurpose = agent({
    id: "gp",
    name: "general-purpose",
    path: "builtin",
    source: "built-in",
  });
  assert.deepEqual(
    mapAgentsToMentionItems([builtInExplore, generalPurpose], { teamMode: true }).map(
      (item) => item.label,
    ),
    ["general-purpose"],
  );
  assert.deepEqual(
    mapAgentsToMentionItems([builtInExplore], { teamMode: false }).map((item) => item.label),
    ["Explore"],
  );
  // 用户自建的同名 Explore 是合法成员，不能一起隐藏。
  assert.deepEqual(
    mapAgentsToMentionItems([agent({ id: "own", name: "Explore" })], { teamMode: true }).map(
      (item) => item.label,
    ),
    ["Explore"],
  );
});

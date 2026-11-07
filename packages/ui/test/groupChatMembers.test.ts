import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import {
  buildGroupChatMemberRoster,
  normalizeGroupChatMemberName,
  resolveGroupChatMember,
  type GroupChatRosterAgentSource,
  type GroupChatRosterRunningSource,
} from "../src/lib/groupChatMembers.js";

/**
 * 多智能体群聊「成员身份 + 成员面板」的两层断言。
 *
 * 第一层（纯函数）：名册的筛选与状态合成规则 —— 谁能进面板、顺序、状态词。
 * 第二层（真实 DOM）：面板是不是真的把头像 + 名字 + 简介渲染出来，以及
 * 「没跑过的成员不可点」这条边界有没有进渲染结果。纯函数测试证明不了
 * 「那个区块有没有进 DOM」，所以第二层用 react-dom/server 渲染真组件。
 *
 * 反向验证：把 buildGroupChatMemberRoster 里的 `kind !== "team"` 过滤去掉，
 * 第一条测试的「内置子智能体不进面板」断言必须变红；把
 * `enabled === false` 过滤去掉，第二条必须变红。
 *
 * 运行：cd packages/ui && node --import tsx --test test/groupChatMembers.test.ts
 */

const TEAM: GroupChatRosterAgentSource[] = [
  {
    id: "agent-frontend-auditor",
    name: "frontend-auditor",
    description: "前端审计：查依赖与构建配置",
    color: "blue",
    kind: "team",
    enabled: true,
  },
  {
    id: "agent-backend-auditor",
    name: "backend-auditor",
    description: "后端审计：查接口鉴权",
    avatar: { kind: "emoji", value: "🧪" },
    color: "green",
    kind: "team",
    enabled: true,
  },
  {
    id: "agent-retired",
    name: "retired-member",
    description: "已停用的成员",
    kind: "team",
    enabled: false,
  },
  {
    id: "agent-builtin-explore",
    name: "explore",
    description: "内置子智能体",
    kind: undefined,
    enabled: true,
  },
];

test("名册：只收团队成员，且按存储顺序排列", () => {
  const roster = buildGroupChatMemberRoster({ agents: TEAM, running: [] });
  assert.deepEqual(
    roster.map((entry) => entry.name),
    ["frontend-auditor", "backend-auditor"],
    "内置子智能体与 team 之外的类型都不得进成员面板",
  );
});

test("名册：停用成员不进面板（点了也起不来）", () => {
  const roster = buildGroupChatMemberRoster({ agents: TEAM, running: [] });
  assert.equal(
    roster.some((entry) => entry.name === "retired-member"),
    false,
    "enabled === false 的成员必须被剔除",
  );
});

test("名册：没在跑的成员是 idle 且没有 childSessionId（因此不可点）", () => {
  const roster = buildGroupChatMemberRoster({ agents: TEAM, running: [] });
  const frontend = roster.find((entry) => entry.name === "frontend-auditor");
  assert.ok(frontend);
  assert.equal(frontend.status, "idle");
  assert.equal(frontend.childSessionId, undefined, "无运行会话时不得编造 childSessionId");
  assert.equal(frontend.description, "前端审计：查依赖与构建配置", "简介必须透传");
  assert.equal(frontend.color, "blue", "头像颜色必须透传");
});

test("名册：运行态来自子会话投影，取最新一次派单", () => {
  const running: GroupChatRosterRunningSource[] = [
    {
      childSessionId: "child-old",
      subagentType: "frontend-auditor",
      status: "blocked",
      startedAt: 100,
    },
    {
      childSessionId: "child-new",
      subagentType: "frontend-auditor",
      status: "running",
      startedAt: 200,
    },
  ];
  const roster = buildGroupChatMemberRoster({ agents: TEAM, running });
  const frontend = roster.find((entry) => entry.name === "frontend-auditor");
  assert.ok(frontend);
  assert.equal(frontend.status, "running");
  assert.equal(frontend.childSessionId, "child-new", "连续派单取 startedAt 最新的一条");
});

test("名字归一化与解析：trim + 大小写不敏感，name 优先于 id", () => {
  assert.equal(normalizeGroupChatMemberName("  Frontend-Auditor "), "frontend-auditor");
  assert.equal(resolveGroupChatMember(TEAM, " FRONTEND-AUDITOR ")?.id, "agent-frontend-auditor");
  assert.equal(resolveGroupChatMember(TEAM, "agent-backend-auditor")?.name, "backend-auditor");
  assert.equal(resolveGroupChatMember(TEAM, "  ")?.id, undefined);
  assert.equal(resolveGroupChatMember(TEAM, "nobody"), undefined);
});

/** 渲染成员面板（真组件 + 真 Intl provider，与浏览器里的调用路径一致）。 */
async function renderRail(props: {
  members: ReturnType<typeof buildGroupChatMemberRoster>;
  collapsed?: boolean;
  onOpenMember?: (member: never) => void;
}): Promise<string> {
  const [{ GroupChatMemberRail }, { ZCodeIntlProvider }] = await Promise.all([
    import("../src/v4/GroupChatMemberRail.js"),
    import("../src/i18n/IntlProvider.js"),
  ]);
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(GroupChatMemberRail, {
        members: props.members,
        collapsed: props.collapsed ?? false,
        onToggleCollapsed: () => {},
        onOpenMember: props.onOpenMember ?? (() => {}),
      } as never),
    ),
  );
}

test("DOM：面板把头像、名字、简介、状态都渲染出来", async () => {
  const members = buildGroupChatMemberRoster({
    agents: TEAM,
    running: [
      { childSessionId: "child-1", subagentType: "frontend-auditor", status: "running" },
    ],
  });
  const html = await renderRail({ members, onOpenMember: () => {} });
  assert.ok(html.includes("chat-group-chat-member-rail"), "面板根节点必须进 DOM");
  assert.ok(html.includes("chat-group-chat-member-rail-item-frontend-auditor"), "成员行必须进 DOM");
  assert.ok(html.includes("frontend-auditor"), "名字必须进 DOM");
  assert.ok(html.includes("前端审计：查依赖与构建配置"), "简介必须进 DOM");
  assert.ok(html.includes("运行中"), "运行状态必须渲染成用户看得懂的词");
  assert.ok(html.includes("未开始"), "未运行的成员显示「未开始」，不是空白");
  assert.ok(
    html.includes('data-member-status="running"'),
    "状态必须同时有机器可读属性（探针据此断言）",
  );
  // 头像是身份的一部分，必须走 TeamMemberAvatar 的三级回退（emoji 头像原样透传）。
  assert.ok(html.includes("🧪"), "成员头像必须渲染出来（不是只有首字母色块）");
  assert.ok(html.includes("rounded-full"), "头像容器必须来自 TeamMemberAvatar");
});

test("DOM：没有 childSessionId 的成员不可点（不隐式建会话）", async () => {
  const members = buildGroupChatMemberRoster({ agents: TEAM, running: [] });
  const html = await renderRail({ members, onOpenMember: () => {} });
  assert.equal(
    html.includes("<button type=\"button\" data-testid=\"chat-group-chat-member-rail-item-frontend-auditor\""),
    false,
    "无运行会话的成员必须是静态行，不能渲染成点击入口",
  );
  assert.ok(html.includes('data-testid="chat-group-chat-member-rail-item-frontend-auditor"'));
});

test("DOM：折叠态只留头像，且仍然暴露展开入口", async () => {
  const members = buildGroupChatMemberRoster({ agents: TEAM, running: [] });
  const html = await renderRail({ members, collapsed: true });
  assert.ok(html.includes('data-collapsed="true"'));
  assert.equal(html.includes("前端审计：查依赖与构建配置"), false, "折叠态不渲染简介文本");
  assert.ok(html.includes("chat-group-chat-member-rail-toggle"), "折叠态必须有展开按钮");
  assert.ok(html.includes("展开成员面板"), "展开按钮需要有可读标签");
});

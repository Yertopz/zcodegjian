import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySessionEventStore, type SessionId, type TraceContext } from "@zcode/contracts";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { refreshBranchAwareBuiltInTools } from "../src/runtime/methods/embedded-search-branch.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import {
  createChildMultiAgentSettings,
  createMainRuntimeMultiAgentSettings,
  MULTI_AGENT_PROMPT_ID,
  resolveIncludeAgentTool,
  resolveIncludeCreateAgentTool,
  resolveMultiAgentPromptActive,
  resolvePeerMessageBudgetLimit,
} from "../src/runtime/helpers/multi-agent-config.js";
import { createPeerMessageBudget, createPeerSubagentPort } from "../src/subagent/peer-message.js";
import { createSubagentMessageSink } from "../src/subagent/message-steering.js";
import { createExploreSubagentPort } from "../src/subagent/runner.js";
import { parseAgentProfileFromMarkdown, type AgentProfile } from "../src/subagent/profile.js";
import { InMemoryRuntimeTaskRegistry, type RuntimeTaskSnapshot } from "../src/runtime-task/registry.js";
import { createCreateAgentToolEntry, type CreateAgentTarget } from "../src/tool/handlers/create-agent.js";

const parent = "parent" as SessionId;
const trace = { traceId: "trace", spanId: "span", sessionId: parent } as TraceContext;

const memberProfile: AgentProfile = {
  name: "docs-writer",
  description: "写用户文档",
  source: "user",
  systemPrompt: "你负责写文档。",
};

function teamSettings(mentionLimit = 4) {
  return createMainRuntimeMultiAgentSettings({ enabled: true, mentionLimit, creatorAgentId: "main" });
}

function createRuntime(
  config: Parameters<typeof AgentRuntime>[1],
  port?: ReturnType<typeof createPeerSubagentPort>,
): AgentRuntime {
  return new AgentRuntime(parent, config, {
    eventStore: createInMemorySessionEventStore(),
    modelFactory: () => {
      throw new Error("no model in test");
    },
    ...(port ? { subagentPort: port } : {}),
  });
}

function toolNames(runtime: AgentRuntime): string[] {
  return runtime.getTools().map((tool) => tool.name);
}

// ---------------------------------------------------------------
// 工具门：多智能体模式下不能派生，只能 @
// ---------------------------------------------------------------

test("团队主运行时下架 Agent/Task，保留 SendMessage 与 CreateAgent", () => {
  const runtime = createRuntime({
    taskType: "main",
    subagents: { enabled: true, profiles: [memberProfile], userAgentsDir: join(tmpdir(), "zcode-agents-test") },
    multiAgent: teamSettings(),
    toolAllowlist: ["Agent", "Task", "SendMessage", "CreateAgent", "Read"],
  });
  const names = toolNames(runtime);
  assert.ok(!names.includes("Agent"));
  assert.ok(!names.includes("Task"));
  assert.ok(names.includes("SendMessage"));
  // 创建者（main）才有建人入口。
  assert.ok(names.includes("CreateAgent"));

  refreshBranchAwareBuiltInTools(runtime as unknown as AgentRuntimeInternal);
  const refreshed = toolNames(runtime);
  assert.ok(!refreshed.includes("Agent"));
  assert.ok(refreshed.includes("SendMessage"));
  assert.ok(refreshed.includes("CreateAgent"));
});

test("团队成员同样不能派生，也拿不到 CreateAgent", () => {
  // 成员运行时由 `runExploreAgent` 构造：`subagents.enabled = false`，团队设置继承
  // `enabled = false`（不再组队），只有被指定的创建者保留 `canCreateAgents`。
  const runtime = createRuntime({
    taskType: "subagent_child",
    subagents: { enabled: false },
    multiAgent: createChildMultiAgentSettings(teamSettings(), "docs-writer"),
    toolAllowlist: ["Agent", "Task", "SendMessage", "CreateAgent", "Read"],
  });
  const names = toolNames(runtime);
  assert.ok(!names.includes("Agent"));
  assert.ok(!names.includes("Task"));
  assert.ok(!names.includes("CreateAgent"));
});

test("被指定为创建者的成员可以建人，但仍然不能派生", () => {
  const creatorSettings = createMainRuntimeMultiAgentSettings({
    enabled: true,
    mentionLimit: 4,
    creatorAgentId: "docs-writer",
  });
  const runtime = createRuntime({
    taskType: "subagent_child",
    subagents: { enabled: false, userAgentsDir: join(tmpdir(), "zcode-agents-test") },
    multiAgent: createChildMultiAgentSettings(creatorSettings, "docs-writer"),
    toolAllowlist: ["Agent", "SendMessage", "CreateAgent", "Read"],
  });
  const names = toolNames(runtime);
  assert.ok(!names.includes("Agent"));
  assert.ok(names.includes("CreateAgent"));
});

test("关闭多智能体时保持原有派生能力", () => {
  const config = { subagents: { enabled: true, profiles: [memberProfile] } };
  assert.equal(resolveIncludeAgentTool({ config, hasSubagentPort: true }), true);
  assert.equal(resolveIncludeCreateAgentTool(config), false);
  assert.equal(resolvePeerMessageBudgetLimit(config), 32);
});

// ---------------------------------------------------------------
// 主提示词门：「多智能体模式」提示词与团队开关同等下架派生工具
// ---------------------------------------------------------------

test("主提示词 multi-agent-mode 激活时 Agent/Task 下架，SendMessage 保留", () => {
  const config = {
    subagents: { enabled: true, profiles: [memberProfile] },
    mainAgentPrompt: { id: MULTI_AGENT_PROMPT_ID, name: "多智能体模式", description: "d", prompt: "p" },
  };
  assert.equal(resolveMultiAgentPromptActive(config), true);
  assert.equal(resolveIncludeAgentTool({ config, hasSubagentPort: true }), false);

  // 结构性生效同样覆盖快照刷新入口：runtime 级验证（工具注册后 refresh 再查表）。
  const runtime = createRuntime({
    taskType: "main",
    subagents: { enabled: true, profiles: [memberProfile], userAgentsDir: join(tmpdir(), "zcode-agents-test") },
    mainAgentPrompt: { id: MULTI_AGENT_PROMPT_ID, name: "多智能体模式", description: "d", prompt: "p" },
    toolAllowlist: ["Agent", "Task", "SendMessage", "Read"],
  });
  const names = toolNames(runtime);
  assert.ok(!names.includes("Agent"));
  assert.ok(!names.includes("Task"));
  assert.ok(names.includes("SendMessage"));
  refreshBranchAwareBuiltInTools(runtime as unknown as AgentRuntimeInternal);
  const refreshed = toolNames(runtime);
  assert.ok(!refreshed.includes("Agent"));
  assert.ok(refreshed.includes("SendMessage"));
});

test("构造之后才选中多智能体模式：Agent/Task 当场下架，切走后加回", async () => {
  // 线上时序就是这个样子：bootstrap 先 createSessionRecord（运行时构造、工具表装配完），
  // 再 setMainAgentPrompt 落选择。构造那一刻两个门输入都还没有，Agent/Task 已经被注册，
  // 所以门必须是双向的——选中后要能摘掉，切走要能加回。
  const runtime = createRuntime({
    taskType: "main",
    subagents: { enabled: true, profiles: [memberProfile], userAgentsDir: join(tmpdir(), "zcode-agents-test") },
    toolAllowlist: ["Agent", "Task", "SendMessage", "Read"],
  });
  assert.ok(toolNames(runtime).includes("Agent"), "构造时应先装上派生工具");

  await runtime.setMainAgentPrompt({ id: MULTI_AGENT_PROMPT_ID, traceContext: trace });
  const selected = toolNames(runtime);
  assert.ok(!selected.includes("Agent"), "选中多智能体模式后不能残留派生工具");
  assert.ok(!selected.includes("Task"));
  assert.ok(selected.includes("SendMessage"), "团队协作入口要保留");

  // 门也要能反向：切回无主提示词后派生工具回来，否则「选中即生效」会变成单向锁死。
  await runtime.setMainAgentPrompt({ id: null, traceContext: trace });
  assert.ok(toolNames(runtime).includes("Agent"));
});

test("只带持久选择（构造时 mainAgentPromptId 已就位）同样下架派生工具", () => {
  // 恢复会话 / 新建会话都可能把 id 直接带进 config，此时没有本轮快照也要生效。
  const runtime = createRuntime({
    taskType: "main",
    subagents: { enabled: true, profiles: [memberProfile], userAgentsDir: join(tmpdir(), "zcode-agents-test") },
    mainAgentPromptId: MULTI_AGENT_PROMPT_ID,
    toolAllowlist: ["Agent", "Task", "SendMessage", "Read"],
  });
  const names = toolNames(runtime);
  assert.ok(!names.includes("Agent"));
  assert.ok(!names.includes("Task"));
  assert.ok(names.includes("SendMessage"));
});

test("主提示词门只读持久选择：显式 null 不借快照复活团队门", () => {
  const snapshot = { id: MULTI_AGENT_PROMPT_ID, name: "多智能体模式", description: "d", prompt: "p" };
  assert.equal(resolveMultiAgentPromptActive({ mainAgentPromptId: null, mainAgentPrompt: snapshot }), false);
  assert.equal(resolveMultiAgentPromptActive({ mainAgentPromptId: MULTI_AGENT_PROMPT_ID }), true);
  // 没写持久选择（TUI / headless）时回落到本轮快照。
  assert.equal(resolveMultiAgentPromptActive({ mainAgentPrompt: snapshot }), true);
});

test("其他主提示词不影响派生工具", () => {
  const config = {
    subagents: { enabled: true, profiles: [memberProfile] },
    mainAgentPrompt: { id: "example-review", name: "代码审查", description: "d", prompt: "p" },
  };
  assert.equal(resolveMultiAgentPromptActive(config), false);
  assert.equal(resolveIncludeAgentTool({ config, hasSubagentPort: true }), true);
});

test("主提示词门不改变团队额度语义", () => {
  // 提示词激活但团队开关未开：保持默认 32 次（轻量团队不启用设置页额度）。
  const config = {
    mainAgentPrompt: { id: MULTI_AGENT_PROMPT_ID, name: "多智能体模式", description: "d", prompt: "p" },
  };
  assert.equal(resolvePeerMessageBudgetLimit(config), 32);
});

test("创建者身份与用户 agent 目录缺一不可", () => {
  const withCreator = {
    subagents: { enabled: true, userAgentsDir: join(tmpdir(), "zcode-agents-test") },
    multiAgent: teamSettings(),
  };
  assert.equal(resolveIncludeCreateAgentTool(withCreator), true);
  assert.equal(
    resolveIncludeCreateAgentTool({ ...withCreator, subagents: { enabled: true } }),
    false,
  );
  assert.equal(
    resolveIncludeCreateAgentTool({ ...withCreator, multiAgent: createChildMultiAgentSettings(teamSettings(), "docs-writer") }),
    false,
  );
});

test("团队模式的 @ 上限取设置值", () => {
  assert.equal(resolvePeerMessageBudgetLimit({ multiAgent: teamSettings(3) }), 3);
  assert.equal(resolvePeerMessageBudgetLimit({}), 32);
  // 成员运行时自身不是团队入口（`enabled=false`，额度由父运行时那份预算决定），
  // 因此它读到的上限不参与计算；这里锁住这一点，避免有人改成「成员各自计次」。
  const member = createChildMultiAgentSettings(teamSettings(3), "docs-writer");
  assert.equal(resolvePeerMessageBudgetLimit({ multiAgent: member }), 32);
});

// ---------------------------------------------------------------
// @ 次数：发送方看到剩余，接收方的提示里也带剩余
// ---------------------------------------------------------------

function peerTask(agentId: string, agentType: string): RuntimeTaskSnapshot {
  return {
    type: "local_agent",
    taskId: agentId,
    agentId,
    agentType,
    description: agentType,
    status: "running",
    startedAt: new Date(),
    parentSessionId: parent,
    childSessionId: `${agentId}-session` as SessionId,
    branchGeneration: 0,
  };
}

test("团队上限生效：投递扣减次数，用尽后明确报出上限", async () => {
  const registry = new InMemoryRuntimeTaskRegistry();
  const budget = createPeerMessageBudget(2);
  registry.register(peerTask("agent-a", "Alice"));
  registry.register({
    ...peerTask("agent-b", "Bob"),
    messageSink: { send: async () => "steered" as const },
  });
  const port = createPeerSubagentPort({
    registry,
    parentSessionId: parent,
    senderAgentId: "agent-a",
    senderSessionId: "agent-a-session" as SessionId,
    getBranchGeneration: () => 0,
    isShuttingDown: () => false,
    budget,
  });
  const request = {
    sessionId: "agent-a-session" as SessionId,
    parentToolCallId: "tool-1",
    to: "@Bob",
    summary: "review",
    message: "请检查",
    workingDirectory: ".",
    workspaceRoot: ".",
    trace,
  };
  const first = await port.sendMessage!(request);
  assert.deepEqual(first.mentionBudget, { remaining: 1, limit: 2 });
  const second = await port.sendMessage!({ ...request, parentToolCallId: "tool-2" });
  assert.deepEqual(second.mentionBudget, { remaining: 0, limit: 2 });
  const third = await port.sendMessage!({ ...request, parentToolCallId: "tool-3" });
  assert.equal(third.status, "failed");
  assert.match(third.message, /limit 2/u);
});

test("接收方的注入提示带上剩余 @ 次数", async () => {
  let received: string | undefined;
  const sink = createSubagentMessageSink(
    { steerTurn: async (input) => { received = input.input; return { kind: "queued", pendingInputId: "id" }; } },
    { traceContext: trace },
  );
  await sink.send({
    id: "id",
    message: "第一版在这里",
    summary: "交付",
    queuedAt: new Date(),
    origin: { kind: "peer", agentId: "agent-a", agentType: "Alice", toolCallId: "tool", mentionBudget: { remaining: 3, limit: 4 } },
  });
  assert.match(received ?? "", /本会话剩余 @ 次数：3（上限 4）/u);
});

// ---------------------------------------------------------------
// 团队路由：按成员名拉起
// ---------------------------------------------------------------

function teamPort(profiles: readonly AgentProfile[], enabled = true) {
  const started: Array<{ agentType: string; prompt: string }> = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const port = createExploreSubagentPort({
    runExploreAgent: async (request) => {
      started.push({ agentType: request.agentType, prompt: request.prompt });
      await request.onSessionReady?.();
      return { response: "ok", traceId: trace.traceId, events: [] };
    },
    emitParentEvent: async (event) => {
      events.push({
        type: String(event.type),
        payload: event.payload as Record<string, unknown>,
      });
    },
    profiles,
    runtimeTaskRegistry: new InMemoryRuntimeTaskRegistry(),
    multiAgent: { enabled, mentionLimit: 4 },
  });
  return { port, started, events };
}

function mentionRequest(to: string) {
  return {
    sessionId: parent,
    parentToolCallId: "tool-team",
    to,
    summary: "写一节文档",
    message: "请补写「安装」一节。",
    workingDirectory: ".",
    workspaceRoot: ".",
    trace,
  };
}

test("@成员名会把它在后台拉起来，并告知团队还有谁", async () => {
  const { port, started } = teamPort([memberProfile]);
  const result = await port.sendMessage!(mentionRequest("@docs-writer"));
  assert.equal(result.status, "success");
  assert.equal(result.delivery, "launched");
  assert.match(result.message, /Started team member/u);
  assert.match(result.message, /docs-writer/u);
  assert.equal(started.length, 1);
  assert.equal(started[0]?.agentType, "docs-writer");
  assert.match(started[0]?.prompt ?? "", /安装/u);
});

// 回归：团队成员与一次性子智能体共用 local_agent 运行时通道，只改文案无法区分归属。
// 成员必须带着自己的 `team_` 会话前缀与 `agentKind: "team"` 出生，投影/UI 才有事实可依。
const teamMemberProfile: AgentProfile = { ...memberProfile, kind: "team" };

test("团队成员按团队身份出生：team_ 会话前缀 + agentKind 事件字段", async () => {
  const { port, events } = teamPort([teamMemberProfile]);
  const result = await port.sendMessage!(mentionRequest("@docs-writer"));
  assert.equal(result.delivery, "launched");
  const spawned = events.find((event) => event.type === "subagent_spawned");
  assert.ok(spawned, "成员启动必须发出 subagent_spawned 事件");
  assert.equal(spawned.payload.agentKind, "team");
  assert.match(String(spawned.payload.childSessionId ?? ""), /^sess_team_/u);
});

test("普通子智能体不带团队身份：subagent_ 前缀且无 agentKind", async () => {
  const { port, events } = teamPort([]);
  const result = await port.sendMessage!(mentionRequest("@general-purpose"));
  assert.equal(result.delivery, "launched");
  const spawned = events.find((event) => event.type === "subagent_spawned");
  assert.ok(spawned);
  assert.equal(spawned.payload.agentKind, undefined);
  assert.match(String(spawned.payload.childSessionId ?? ""), /^sess_subagent_/u);
});

test("未知成员明确失败并列出可用成员", async () => {
  const { port, started } = teamPort([memberProfile]);
  const result = await port.sendMessage!(mentionRequest("@nobody"));
  assert.equal(result.status, "failed");
  assert.match(result.message, /Unknown team member/u);
  assert.match(result.message, /docs-writer/u);
  assert.equal(started.length, 0);
});

test("port 创建后才加入的成员同样能 @：profile 来源按引用现读", async () => {
  // 回归：`CreateAgent` 重建 `config.subagents.profiles` 数组，若 port 构造时快照，
  // 新成员会一直被判成未知成员，直到重开进程。
  const started: string[] = [];
  let profiles: readonly AgentProfile[] = [];
  const port = createExploreSubagentPort({
    runExploreAgent: async (request) => {
      started.push(request.agentType);
      await request.onSessionReady?.();
      return { response: "ok", traceId: trace.traceId, events: [] };
    },
    emitParentEvent: async () => {},
    profiles: () => profiles,
    runtimeTaskRegistry: new InMemoryRuntimeTaskRegistry(),
    multiAgent: { enabled: true, mentionLimit: 4 },
  });

  const before = await port.sendMessage!(mentionRequest("@docs-writer"));
  assert.equal(before.status, "failed");
  assert.match(before.message, /Unknown team member/u);

  profiles = [memberProfile];
  const after = await port.sendMessage!({ ...mentionRequest("@docs-writer"), parentToolCallId: "tool-team-2" });
  assert.equal(after.status, "success");
  assert.equal(after.delivery, "launched");
  assert.deepEqual(started, ["docs-writer"]);
});

test("内置 general-purpose 也是可 @ 的成员", async () => {
  // `normalizeAgentProfiles` 始终补回内置 general-purpose，所以团队不会是空集；
  // 这条锁定「内置成员同样能按名字拉起」，避免以后把它当成不可 @ 的保留项。
  const { port, started } = teamPort([]);
  const result = await port.sendMessage!(mentionRequest("@general-purpose"));
  assert.equal(result.status, "success");
  assert.equal(result.delivery, "launched");
  assert.equal(started[0]?.agentType, "general-purpose");
});

test("关闭多智能体后不再按名字路由", async () => {
  const { port } = teamPort([memberProfile], false);
  const result = await port.sendMessage!(mentionRequest("@docs-writer"));
  assert.equal(result.status, "failed");
  assert.match(result.message, /No active local_agent task found/u);
});

// ---------------------------------------------------------------
// CreateAgent：落盘、去重、序列化可回读
// ---------------------------------------------------------------

function createAgentHarness(agentsDir: string, enabledNames: string[] = []) {
  const created: AgentProfile[] = [];
  const target: CreateAgentTarget = {
    agentsDir,
    enabledAgentNames: () => enabledNames,
    onCreated: (profile) => created.push(profile),
  };
  return { entry: createCreateAgentToolEntry({ target }), created };
}

interface CreateAgentResult {
  status: string;
  name: string;
  path?: string;
  message: string;
}

async function runCreateAgent(
  entry: ReturnType<typeof createCreateAgentToolEntry>,
  input: unknown,
): Promise<CreateAgentResult> {
  return (await entry.handler(input, {} as never)) as CreateAgentResult;
}

test("创建成员：写盘、回读同名同描述、并进入本会话 profile 列表", async () => {
  const agentsDir = join(await mkdtemp(join(tmpdir(), "zcode-create-agent-")), "agents");
  const { entry, created } = createAgentHarness(agentsDir);
  const result = await runCreateAgent(entry, {
    name: "release-notes",
    description: "写发布说明：\n每条一句",
    systemPrompt: "你负责整理发布说明。",
    tools: ["Read", "Write"],
  });
  assert.equal(result.status, "created");
  assert.equal(created.length, 1);
  assert.equal(created[0]?.name, "release-notes");
  assert.deepEqual(created[0]?.tools, ["Read", "Write"]);

  const markdown = await readFile(join(agentsDir, "release-notes.md"), "utf8");
  const { profile: parsed, diagnostic } = parseAgentProfileFromMarkdown({
    content: markdown,
    path: join(agentsDir, "release-notes.md"),
    source: "user",
  });
  assert.equal(diagnostic, undefined);
  assert.ok(parsed);
  assert.equal(parsed.name, "release-notes");
  assert.equal(parsed.description, "写发布说明：\n每条一句");
  assert.deepEqual(parsed.tools, ["Read", "Write"]);
  assert.match(parsed.systemPrompt, /发布说明/u);
});

test("同名（含内置保留名）一律返回 exists，不覆盖已有文件", async () => {
  const agentsDir = join(await mkdtemp(join(tmpdir(), "zcode-create-agent-")), "agents");
  const { entry, created } = createAgentHarness(agentsDir, ["already-here"]);
  const first = await runCreateAgent(entry, { name: "already-here", description: "d", systemPrompt: "s" });
  assert.equal(first.status, "exists");
  const reserved = await runCreateAgent(entry, { name: "Explore", description: "d", systemPrompt: "s" });
  assert.equal(reserved.status, "exists");

  const ok = await runCreateAgent(entry, { name: "fresh", description: "d", systemPrompt: "s" });
  assert.equal(ok.status, "created");
  const again = await runCreateAgent(entry, { name: "fresh", description: "d2", systemPrompt: "s2" });
  assert.equal(again.status, "exists");
  assert.equal(created.length, 1);
});

test("名字非法时返回 invalid 并指出哪一项不合法，而不是抛断言文本", async () => {
  const agentsDir = join(await mkdtemp(join(tmpdir(), "zcode-create-agent-")), "agents");
  const { entry, created } = createAgentHarness(agentsDir);
  const result = await runCreateAgent(entry, { name: "bad name", description: "d", systemPrompt: "s" });
  assert.equal(result.status, "invalid");
  assert.equal(result.name, "bad name");
  assert.match(result.message, /invalid/u);
  assert.match(result.message, /name/u);
  assert.equal(created.length, 0);
});

test("CreateAgent 支持 color 与 permissionMode：落盘 frontmatter 可回读", async () => {
  const agentsDir = join(await mkdtemp(join(tmpdir(), "zcode-create-agent-")), "agents");
  const { entry, created } = createAgentHarness(agentsDir);
  const result = await runCreateAgent(entry, {
    name: "reviewer",
    description: "审查代码",
    systemPrompt: "只读审查，不改文件。",
    tools: ["Read", "Grep"],
    permissionMode: "plan",
    color: "blue",
  });
  assert.equal(result.status, "created");
  assert.equal(created[0]?.color, "blue");
  assert.equal(created[0]?.permissionMode, "plan");

  const markdown = await readFile(join(agentsDir, "reviewer.md"), "utf8");
  assert.match(markdown, /color: blue/u);
  assert.match(markdown, /permissionMode: plan/u);
  // CreateAgent 产物固定是多智能体团队成员，落盘 frontmatter 必须带 kind: team。
  assert.match(markdown, /kind: team/u);
  const { profile: parsed, diagnostic } = parseAgentProfileFromMarkdown({
    content: markdown,
    path: join(agentsDir, "reviewer.md"),
    source: "user",
  });
  assert.equal(diagnostic, undefined);
  assert.ok(parsed);
  assert.equal(parsed.color, "blue");
  assert.equal(parsed.permissionMode, "plan");
  assert.equal(parsed.kind, "team");
});

test("CreateAgent 不带 color/permissionMode 时与旧文件形状一致", async () => {
  const agentsDir = join(await mkdtemp(join(tmpdir(), "zcode-create-agent-")), "agents");
  const { entry } = createAgentHarness(agentsDir);
  const result = await runCreateAgent(entry, { name: "plain", description: "d", systemPrompt: "s" });
  assert.equal(result.status, "created");
  const markdown = await readFile(join(agentsDir, "plain.md"), "utf8");
  assert.doesNotMatch(markdown, /color:/u);
  assert.doesNotMatch(markdown, /permissionMode:/u);
});

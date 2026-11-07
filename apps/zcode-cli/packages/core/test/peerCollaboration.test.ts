import assert from "node:assert/strict";
import test from "node:test";
import { createInMemorySessionEventStore, type SessionId, type TraceContext } from "@zcode/contracts";
import { InMemoryRuntimeTaskRegistry, type RuntimeTaskSnapshot } from "../src/runtime-task/registry.js";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { refreshBranchAwareBuiltInTools } from "../src/runtime/methods/embedded-search-branch.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import { createSubagentMessageSink } from "../src/subagent/message-steering.js";
import { createPeerMessageBudget, createPeerSubagentPort } from "../src/subagent/peer-message.js";

const parent = "parent" as SessionId;
const trace = { traceId: "trace", spanId: "span", sessionId: parent } as TraceContext;

function task(agentId: string, agentType: string, extra: Partial<RuntimeTaskSnapshot> = {}): RuntimeTaskSnapshot {
  return {
    type: "local_agent", taskId: agentId, agentId, agentType, description: agentType,
    status: "running", startedAt: new Date(), parentSessionId: parent,
    childSessionId: `${agentId}-session` as SessionId, branchGeneration: 0,
    ...extra,
  };
}

function setup(limit = 32) {
  const registry = new InMemoryRuntimeTaskRegistry();
  const delivered: unknown[] = [];
  registry.register(task("agent-a", "Alice"));
  registry.register(task("agent-b", "Bob", { messageSink: { send: async (message) => { delivered.push(message); return "steered"; } } }));
  const budget = createPeerMessageBudget(limit);
  let generation = 0;
  const port = createPeerSubagentPort({ registry, parentSessionId: parent, senderAgentId: "agent-a", senderSessionId: "agent-a-session" as SessionId, getBranchGeneration: () => generation, isShuttingDown: () => false, budget });
  const request = { sessionId: "agent-a-session" as SessionId, parentToolCallId: "tool", to: "@Bob", summary: "review", message: "请检查", workingDirectory: ".", workspaceRoot: ".", trace };
  return { port, registry, delivered, request, setGeneration: (value: number) => { generation = value; } };
}

test("同会话同伴按名称收到真实发送者身份", async () => {
  const { port, delivered, request } = setup();
  const result = await port.sendMessage!(request);
  assert.equal(result.status, "success");
  assert.equal(result.agentId, "agent-b");
  // 多智能体把「本会话还剩几次 @」随投递一起送给接收方，因此 origin 里多了 mentionBudget；
  // 默认上限 32、本次投递已扣一次。
  assert.deepEqual((delivered[0] as { origin: unknown }).origin, {
    kind: "peer", agentId: "agent-a", agentType: "Alice", toolCallId: "tool",
    mentionBudget: { remaining: 31, limit: 32 },
  });
});

test("拒绝冒用发件人、自发、歧义、终态和旧分支", async () => {
  const { port, registry, request, setGeneration } = setup();
  assert.equal((await port.sendMessage!({ ...request, sessionId: "other" as SessionId })).status, "failed");
  assert.equal((await port.sendMessage!({ ...request, to: "agent-a" })).status, "failed");
  registry.register(task("agent-c", "Bob", { messageSink: { send: async () => "steered" } }));
  assert.equal((await port.sendMessage!(request)).status, "failed");
  registry.remove("agent-c");
  registry.update("agent-b", (value) => ({ ...value, status: "completed" }));
  assert.equal((await port.sendMessage!(request)).status, "failed");
  setGeneration(1);
  assert.equal((await port.sendMessage!({ ...request, to: "agent-b" })).status, "failed");
});

test("消息额度共享且拒绝或失败不会虚报入队", async () => {
  const { port, registry, request } = setup(1);
  registry.update("agent-b", (value) => ({ ...value, messageSink: { send: async () => { throw new Error("closed"); } } }));
  assert.equal((await port.sendMessage!(request)).status, "failed");
  assert.equal((await port.sendMessage!(request)).status, "failed");
  assert.equal(registry.get("agent-b")?.pendingMessages?.length ?? 0, 0);
});

test("相同工具调用重试只投递一次，不能借同一个调用 ID 改写消息", async () => {
  const { port, delivered, request } = setup();
  const [first, repeated] = await Promise.all([port.sendMessage!(request), port.sendMessage!(request)]);
  assert.deepEqual(repeated, first);
  assert.equal(delivered.length, 1);
  assert.equal((await port.sendMessage!({ ...request, message: "另一条消息" })).status, "failed");
  assert.equal(delivered.length, 1);
});

test("目标收件箱使用同伴权限语义而不是协调者语义", async () => {
  let received: unknown;
  const sink = createSubagentMessageSink({ steerTurn: async (input) => { received = input; return { kind: "queued", pendingInputId: "id" }; } }, { traceContext: trace });
  await sink.send({ id: "id", message: "检查结果", summary: "审查", queuedAt: new Date(), origin: { kind: "peer", agentId: "agent-a", agentType: "Alice", toolCallId: "tool" } });
  const input = received as { inputPresentation: string; input: string; inputId: string };
  assert.equal(input.inputPresentation, "subagent_reply_steer");
  assert.match(input.input, /agent-a/);
  assert.equal(input.inputId, "id");
});

test("子运行时只开放受限的同伴消息，不暴露派生工具，刷新工具分支后仍成立", () => {
  const { port } = setup();
  const runtime = new AgentRuntime("agent-a-session" as SessionId, {
    taskType: "subagent_child", subagents: { enabled: false }, toolAllowlist: ["Agent", "Task", "SendMessage"],
  }, { eventStore: createInMemorySessionEventStore(), modelFactory: () => { throw new Error("no model in test"); }, subagentPort: port });
  const inspect = () => {
    const tools = runtime.getTools();
    assert.ok(!tools.some((tool) => tool.name === "Agent" || tool.name === "Task"));
    const message = tools.find((tool) => tool.name === "SendMessage");
    assert.ok(message);
    assert.match(message.description ?? "", /running peer/i);
    assert.doesNotMatch(message.description ?? "", /resume a completed agent/i);
  };
  inspect();
  refreshBranchAwareBuiltInTools(runtime as unknown as AgentRuntimeInternal);
  inspect();
});

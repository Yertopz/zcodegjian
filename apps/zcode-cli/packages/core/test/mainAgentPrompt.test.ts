import assert from "node:assert/strict";
import test from "node:test";
import { ContextBuilder } from "../src/context/builder.js";
import {
  setMainAgentPrompt,
  getMainAgentPromptId,
  restoreMainAgentPromptSelection,
} from "../src/runtime/methods/main-agent-prompt.js";
import { buildPersistedConversationInputIntent } from "../src/runtime/methods/input-intent-persistence.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import {
  createInMemorySessionEventStore,
  createSessionId,
  type Model,
  type ModelRequest,
} from "@zcode/contracts";

const prompt = { id: "one", name: "Review", description: "", prompt: "CUSTOM_MAIN_PROMPT_MARKER" };
const envInfo = {
  cwd: "/workspace",
  platform: "linux",
  shell: "bash",
  osVersion: "fixture",
  nodeVersion: "22",
};

test("冷恢复按会话 entry 还原选择，显式默认优先于旧事件，旧会话使用默认", async () => {
  for (const id of ["role-a", null, undefined]) {
    const runtime = {
      sessionId: "session",
      config: {},
      sessionStore: { sessionEntries: async () => (id === undefined ? [] : [{ data: { id } }]) },
    } as unknown as AgentRuntimeInternal;
    await restoreMainAgentPromptSelection(
      runtime,
      (id === null
        ? [{ type: "main_agent_prompt_selected", payload: { id: "old-role" } }]
        : []) as Parameters<typeof restoreMainAgentPromptSelection>[1],
    );
    assert.equal(getMainAgentPromptId.call(runtime), id ?? null);
  }
});

test("模型 system messages 包含追加正文、保留默认行为和环境；默认与工作流子身份不注入", () => {
  const build = (extra = {}) =>
    new ContextBuilder({ workingDirectory: envInfo.cwd, envInfo, ...extra }).build();
  const selected = build({ mainAgentPrompt: prompt });
  const system = JSON.stringify(selected.systemMessages);
  assert.match(system, /CUSTOM_MAIN_PROMPT_MARKER/);
  assert.match(system, /interactive ZCode agent/);
  assert.match(system, /Context management/);
  assert.match(system, /Primary working directory/);
  assert.doesNotMatch(JSON.stringify(build().systemMessages), /CUSTOM_MAIN_PROMPT_MARKER/);
  assert.doesNotMatch(
    JSON.stringify(
      build({ mainAgentPrompt: prompt, workflowActor: { name: "child" } }).systemMessages,
    ),
    /CUSTOM_MAIN_PROMPT_MARKER/,
  );
});

test("选择持久化后发布事件且不改执行轮快照，失败保留原选择", async () => {
  const entries: unknown[] = [];
  const events: unknown[] = [];
  const runtime = {
    config: { mainAgentPromptId: "old", mainAgentPrompt: prompt },
    sessionId: "session",
    rootTraceContext: { traceId: "trace" },
    sessionPersisted: true,
    sessionStore: {
      saveSessionEntry: async (entry: unknown) => {
        entries.push(entry);
      },
    },
    appendEvent: async (event: unknown) => {
      events.push(event);
    },
  } as unknown as AgentRuntimeInternal;
  await setMainAgentPrompt.call(runtime, { id: "new" });
  assert.equal(getMainAgentPromptId.call(runtime), "new");
  assert.equal(runtime.config.mainAgentPrompt, prompt);
  assert.equal(entries.length, 1);
  assert.equal(events.length, 1);
  runtime.sessionStore!.saveSessionEntry = async () => {
    throw new Error("disk unavailable");
  };
  await assert.rejects(setMainAgentPrompt.call(runtime, { id: null }), /disk unavailable/);
  assert.equal(getMainAgentPromptId.call(runtime), "new");
  assert.equal(events.length, 1);
});

test("queue 持久化消费的是 admission 快照", () => {
  const result = buildPersistedConversationInputIntent(
    "inspect",
    {
      mainAgentPrompt: prompt,
      sourceCommandId: "cmd",
      queueItemId: "q",
      clientId: "c",
      kind: "sendText",
      admissionSeq: 1,
      admittedAt: 1,
      requestedDelivery: "queue",
      admittedDelivery: "queue",
    },
    "queued",
  );
  assert.deepEqual(result?.mainAgentPrompt, prompt);
});

test("真实主 Agent loop 在最终 provider 请求中使用本轮快照，忙碌时切换只影响下一轮", async () => {
  const requests: ModelRequest[] = [];
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model = {
    providerId: "fixture",
    modelId: "main",
    options: {},
    optionSpecs: { maxOutputTokens: { max: 4096, map: "maxOutputTokens" } },
    properties: {
      contextWindow: 200000,
      inputFormat: { supportsText: true },
      outputFormat: { supportsText: true },
      supportsToolCall: false,
      supportsMidConversationSystem: true,
    },
    bind() {
      return this;
    },
    async generateText(request: ModelRequest) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        entered();
        await gate;
      }
      return {
        text: "Completed.",
        finishReason: "stop",
        usage: { inputTokens: 20, outputTokens: 2 },
      };
    },
  } as unknown as Model;
  const runtime = new AgentRuntime(
    createSessionId(),
    {
      workingDirectory: envInfo.cwd,
      envInfo,
      memory: { enabled: false },
      modelStreaming: "off",
      modelSelection: { providerId: "fixture", modelId: "main" },
    },
    { eventStore: createInMemorySessionEventStore(), modelFactory: () => model },
  );
  const first = await runtime.admitPrompt("inspect", undefined, {
    intent: {
      mainAgentPrompt: prompt,
      sourceCommandId: "first",
      queueItemId: "first",
      clientId: "c",
      kind: "sendText",
      admissionSeq: 1,
      admittedAt: 1,
      requestedDelivery: "startNow",
      admittedDelivery: "startNow",
    },
  });
  if (first.kind !== "started") throw new Error(`unexpected admission: ${first.kind}`);
  await Promise.race([
    started,
    first.completion.then(() => {
      throw new Error("Turn completed before provider call");
    }),
  ]);
  await runtime.setMainAgentPrompt({ id: "changed-while-running" });
  release();
  const admission = first;
  assert.equal(admission.kind, "started");
  if (admission.kind === "started") await admission.completion;
  assert.match(JSON.stringify(requests[0]!.messages), /CUSTOM_MAIN_PROMPT_MARKER/);
  await runtime.executeTurn("next", undefined, {
    intent: {
      mainAgentPrompt: { ...prompt, prompt: "UPDATED_PROMPT_MARKER" },
      sourceCommandId: "second",
      queueItemId: "second",
      clientId: "c",
      kind: "sendText",
      admissionSeq: 2,
      admittedAt: 2,
      requestedDelivery: "startNow",
      admittedDelivery: "startNow",
    },
  });
  assert.match(
    JSON.stringify(requests.at(-1)!.messages.filter((message) => message.role === "system")),
    /UPDATED_PROMPT_MARKER/,
  );
  assert.doesNotMatch(
    JSON.stringify(requests.at(-1)!.messages.filter((message) => message.role === "system")),
    /CUSTOM_MAIN_PROMPT_MARKER/,
  );
});

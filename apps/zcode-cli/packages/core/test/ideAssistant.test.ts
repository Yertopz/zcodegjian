import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemorySessionEventStore,
  createSessionId,
  type Model,
  type ModelRequest,
  type TurnInputIntentMetadata,
} from "@zcode/contracts";
import { AgentRuntime } from "../src/runtime/agent-runtime.js";
import { isIdeToolAllowed } from "../src/runtime/helpers/ide-tool-policy.js";
import { executeToolCall } from "../src/tool/executor/call-runner.js";
import type { ToolExecutorDeps } from "../src/tool/executor/types.js";
import { MAIN_ASSISTANT_PROMPT, IDE_ASSISTANT_PROMPT } from "@zcode/shared";
import { buildPersistedConversationInputIntent } from "../src/runtime/methods/input-intent-persistence.js";

const context = {
  version: 1 as const,
  activeFile: { absolutePath: "/project/current.ts", hasUnsavedChanges: true },
};
const prompt = { id: "selected", name: "User role", description: "", prompt: "USER_SELECTED_ROLE" };
function intent(id: string, ide = true): TurnInputIntentMetadata {
  return {
    sourceCommandId: id,
    queueItemId: id,
    clientId: "fixture",
    kind: "sendText",
    admissionSeq: 1,
    admittedAt: 1,
    requestedDelivery: "queue",
    admittedDelivery: "queue",
    mainAgentPrompt: prompt,
    ...(ide ? { ideContext: structuredClone(context) } : {}),
  };
}

test("IDE canonical persistence retains active file snapshot", () => {
  const input = intent("snapshot");
  const saved = buildPersistedConversationInputIntent("explain", input, "queued");
  assert.deepEqual(saved?.ideContext, context);
});

test("IDE executor denies registered forbidden tools before handlers/permissions", async () => {
  for (const name of [
    "Agent",
    "Skill",
    "CreateWorkflow",
    "BrowserUse",
    "WebSearch",
    "mcp__fixture__read",
    "SendMessage",
  ]) {
    let executed = false;
    const events: unknown[] = [];
    const entry = {
      metadata: { name },
      handler: async () => {
        executed = true;
      },
    };
    const deps = {
      registry: { get: () => entry },
      sessionId: "ide-deny",
      emitEvent: async (event: unknown) => {
        events.push(event);
      },
      isToolAllowed: (tool: string) => isIdeToolAllowed(context, tool),
    } as unknown as ToolExecutorDeps;
    const result = await executeToolCall(deps, {} as never, { id: "forbidden", name, input: {} });
    assert.equal(executed, false);
    assert.equal(result.success, false);
    assert.match(String(result.error?.message), /ide_tool_not_allowed/);
    assert.ok(events.length);
  }
});

test("real runtime requests use IDE prompt/tools; refresh and next ordinary turn restore correctly", async () => {
  const requests: ModelRequest[] = [];
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const model = {
    providerId: "fixture",
    modelId: "ide",
    options: {},
    optionSpecs: { maxOutputTokens: { max: 4096, map: "maxOutputTokens" } },
    properties: {
      contextWindow: 200000,
      inputFormat: { supportsText: true },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
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
      return { text: "Done", finishReason: "stop", usage: { inputTokens: 20, outputTokens: 2 } };
    },
  } as unknown as Model;
  const eventStore = createInMemorySessionEventStore();
  const sessionId = createSessionId();
  const runtime = new AgentRuntime(
    sessionId,
    {
      workingDirectory: "/project",
      envInfo: {
        cwd: "/project",
        platform: "linux",
        shell: "bash",
        osVersion: "fixture",
        nodeVersion: "24",
      },
      memory: { enabled: false },
      toolSearch: { mode: "local" },
      modelStreaming: "off",
      modelSelection: { providerId: "fixture", modelId: "ide" },
    },
    { eventStore, modelFactory: () => model },
  );
  const first = await runtime.admitPrompt("inspect", undefined, { intent: intent("first") });
  if (first.kind !== "started") throw new Error(first.kind);
  await Promise.race([
    started,
    first.completion.then(() => {
      throw new Error("No model call");
    }),
  ]);
  // 模拟设置变更导致工具重新装配。IDE 的过滤必须仍在注册表之后执行。
  await runtime.setMainAgentPrompt({ id: "another-selection" });
  assert.ok(runtime.getTools().every((tool) => isIdeToolAllowed(context, tool.name)));
  const queuedIntent = intent("queued");
  queuedIntent.ideContext = {
    version: 1,
    activeFile: { absolutePath: "/project/queued.ts", hasUnsavedChanges: false },
  };
  const queued = await runtime.admitPrompt("next queued", undefined, {
    intent: queuedIntent,
    queueDelivery: "guide",
  });
  assert.equal(queued.kind, "queued");
  assert.equal(
    runtime.getActiveTurnInfo()?.queueLength,
    0,
    "IDE input must not steer the active turn",
  );
  release();
  await first.completion;
  assert.ok(
    requests[0]?.messages.some(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.includes(IDE_ASSISTANT_PROMPT),
    ),
  );
  assert.ok(
    !requests[0]?.messages.some(
      (message) =>
        typeof message.content === "string" && message.content.includes(MAIN_ASSISTANT_PROMPT),
    ),
  );
  assert.match(JSON.stringify(requests[0]?.messages), /current\.ts/);
  assert.doesNotMatch(JSON.stringify(requests[0]?.messages), /USER_SELECTED_ROLE/);
  assert.ok((requests[0]?.tools ?? []).every((tool) => isIdeToolAllowed(context, tool.name)));
  // 从实际入队事件恢复输入，而不是重新读取当前文件。模拟 UI 已切到另一文件。
  const queuedEvent = (await eventStore.getEvents(sessionId)).find(
    (event) => event.type === "turn_steer_queued",
  );
  assert.ok(queuedEvent);
  const saved = JSON.parse(JSON.stringify(queuedEvent.payload)) as {
    intent: TurnInputIntentMetadata;
    input: string;
  };
  queuedIntent.ideContext = {
    version: 1,
    activeFile: { absolutePath: "/project/later.ts", hasUnsavedChanges: false },
  };
  await runtime.executeTurn(saved.input, undefined, { intent: saved.intent });
  assert.match(JSON.stringify(requests.at(-1)?.messages), /queued\.ts/);
  assert.doesNotMatch(JSON.stringify(requests.at(-1)?.messages), /later\.ts/);
  await runtime.executeTurn("ordinary", undefined, { intent: intent("ordinary", false) });
  assert.match(JSON.stringify(requests.at(-1)?.messages), /USER_SELECTED_ROLE/);
  assert.ok(
    requests
      .at(-1)
      ?.messages.some(
        (message) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.includes(MAIN_ASSISTANT_PROMPT),
      ),
  );
  assert.doesNotMatch(JSON.stringify(requests.at(-1)?.messages), /IDE context \(data\)/);
});

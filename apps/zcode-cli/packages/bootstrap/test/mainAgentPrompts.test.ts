import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_HANDLERS } from "../src/zcode-protocol-v4/commands/handlers/index.js";
import {
  inputIntentMetadataFromCanonical,
  inputIntentMetadataFromQueueItem,
} from "../src/zcode-protocol-v4/commands/input-intent.js";
import type { V4CommandCoreHost } from "../src/zcode-protocol-v4/commands/types.js";
import type { CommandEnvelope, QueueItem } from "@zcode/shared/zcode-protocol-v4";
import { createMainAgentPromptResolver } from "../src/zcode-protocol-v4/main-agent-prompts.js";

const prompt = { id: "p", name: "Prompt", description: "", prompt: "frozen-v1" };

test("admission 后编辑/删除库不改变队列快照，新提交才读取新版且会话独立", async () => {
  let library = { version: 1 as const, defaultId: null, prompts: [prompt] };
  let saved: typeof prompt | null | undefined = prompt;
  const resolve = createMainAgentPromptResolver({
    readLibrary: async () => library,
    getSelection: (sessionId) => (sessionId === "selected" ? prompt.id : null),
    getAdmittedInput: async () =>
      saved === undefined
        ? null
        : { payload: { conversationInputIntent: { mainAgentPrompt: saved } } },
  });
  library = { ...library, prompts: [{ ...prompt, prompt: "updated-v2" }] };
  assert.equal((await resolve("selected", envelope))?.prompt, "frozen-v1");
  assert.equal((await resolve("selected"))?.prompt, "updated-v2");
  assert.equal(await resolve("other"), null);
  saved = null;
  assert.equal(await resolve("selected", envelope), null);
  library = { ...library, prompts: [] };
  assert.equal(await resolve("selected"), null);
});
const envelope = {
  commandId: "cmd",
  clientId: "client",
  sessionId: "s",
  type: "setMainAgentPrompt",
  payload: { id: "p" },
  issuedAt: 1,
  baseRevision: 0,
} as CommandEnvelope;

test("选择命令验证 Host 库，失效条目拒绝，默认始终可选", async () => {
  const selected: (string | null)[] = [];
  const host = {
    getRecord: () => ({
      app: {
        sessionId: "s",
        runtime: {
          setMainAgentPrompt: async ({ id }: { id: string | null }) => {
            selected.push(id);
          },
        },
      },
      traceContext: { traceId: "t" },
    }),
    readMainAgentPromptLibrary: async () => ({ version: 1, defaultId: null, prompts: [prompt] }),
  } as unknown as V4CommandCoreHost;
  await NATIVE_HANDLERS.setMainAgentPrompt(host, envelope);
  await assert.rejects(
    NATIVE_HANDLERS.setMainAgentPrompt(host, { ...envelope, payload: { id: "deleted" } }),
    /no longer exists/,
  );
  await NATIVE_HANDLERS.setMainAgentPrompt(host, { ...envelope, payload: { id: null } });
  assert.deepEqual(selected, ["p", null]);
});

test("重试和队列提升保持原快照，包括 null 默认", () => {
  for (const mainAgentPrompt of [prompt, null]) {
    const canonical = { kind: "sendText" as const, text: "inspect", mainAgentPrompt };
    assert.deepEqual(
      inputIntentMetadataFromCanonical(envelope, canonical).mainAgentPrompt,
      mainAgentPrompt,
    );
    const queued = {
      ...canonical,
      sourceCommandId: "old",
      queueItemId: "q",
      clientId: "client",
      attachments: [],
      delivery: { requested: "queue", admitted: "queue" },
      order: { admissionSeq: 1 },
      admittedAt: 1,
    } as QueueItem;
    assert.deepEqual(
      inputIntentMetadataFromQueueItem(queued, "inspect").mainAgentPrompt,
      mainAgentPrompt,
    );
  }
});

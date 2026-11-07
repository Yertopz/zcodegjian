import assert from "node:assert/strict";
import test from "node:test";
import { appSettingsSchema, appSettingsPatchSchema } from "../src/validationAppSettings.js";
import {
  composeMainAgentPromptText,
  mainAgentPromptLibrarySchema,
  MULTI_AGENT_PROMPT_ID,
  resolveMainAgentPrompt,
} from "../src/main-agent-prompts.js";
import { zcodeSessionRuntimePreferencesResultSchema } from "../src/zcode-protocol/index.js";
import { conversationInputIntentSchema } from "../src/zcode-protocol-v4/input-intent.js";

test("保存空列表后读取会补进内置条目；其余用户自定义字段原样保留", () => {
  const settings = appSettingsSchema.parse({});
  assert.equal(settings.mainAgentPrompts.prompts.length, 4);
  const mainAgentPrompts = { version: 1 as const, defaultId: null, prompts: [] };
  const patch = appSettingsPatchSchema.parse({ mainAgentPrompts });
  const reparsed = appSettingsSchema.parse({ ...settings, ...patch }).mainAgentPrompts;
  // 迁移保证内置「多智能体模式」始终在库中（幂等补齐）；其余内置示例不回填。
  assert.deepEqual(
    reparsed.prompts.map((item) => item.id),
    [MULTI_AGENT_PROMPT_ID],
  );
  assert.equal(reparsed.version, 1);
  assert.equal(reparsed.defaultId, null);
});

test("允许同名但拒绝同 ID、空正文、超长正文；失效引用返回默认", () => {
  const library = appSettingsSchema.parse({}).mainAgentPrompts;
  const item = library.prompts[0]!;
  assert.equal(
    mainAgentPromptLibrarySchema.safeParse({
      ...library,
      prompts: [item, { ...item, id: "another" }],
    }).success,
    true,
  );
  assert.equal(
    mainAgentPromptLibrarySchema.safeParse({ ...library, prompts: [item, item] }).success,
    false,
  );
  for (const prompt of ["  ", "x".repeat(50001)]) {
    assert.equal(
      mainAgentPromptLibrarySchema.safeParse({ ...library, prompts: [{ ...item, prompt }] })
        .success,
      false,
    );
  }
  assert.equal(resolveMainAgentPrompt(library, "deleted"), null);
  assert.equal(resolveMainAgentPrompt(library, null), null);
});

test("默认库包含「多智能体模式」且 id 与 MULTI_AGENT_PROMPT_ID 一致", () => {
  const library = appSettingsSchema.parse({}).mainAgentPrompts;
  const multiAgent = library.prompts.find((item) => item.id === MULTI_AGENT_PROMPT_ID);
  assert.ok(multiAgent, "默认库必须包含 multi-agent-mode 条目");
  assert.equal(multiAgent.name, "多智能体模式");
  assert.ok(multiAgent.prompt.includes("SendMessage"));
  assert.ok(multiAgent.prompt.includes("多智能体"));
  assert.equal(resolveMainAgentPrompt(library, MULTI_AGENT_PROMPT_ID)?.id, MULTI_AGENT_PROMPT_ID);
});

// 旧版设置文件物化过 3 条示例库，schema default 不生效；迁移必须幂等补齐内置条目。
test("已落盘的旧版库自动补进「多智能体模式」，用户自定义同 id 时不覆盖", () => {
  const legacyLibrary = { version: 1 as const, defaultId: null, prompts: [] };
  const parsed = appSettingsSchema.parse({ mainAgentPrompts: legacyLibrary });
  assert.ok(
    parsed.mainAgentPrompts.prompts.some((item) => item.id === MULTI_AGENT_PROMPT_ID),
    "空库迁移后必须包含内置条目",
  );

  const custom = {
    id: MULTI_AGENT_PROMPT_ID,
    name: "我的自定义多智能体",
    description: "用户自己写的",
    prompt: "自定义内容",
  };
  const withCustom = appSettingsSchema.parse({
    mainAgentPrompts: { version: 1, defaultId: null, prompts: [custom] },
  });
  assert.equal(withCustom.mainAgentPrompts.prompts.length, 1);
  assert.deepEqual(withCustom.mainAgentPrompts.prompts[0], custom);
});

test("追加提示词是独立字段：老库无该字段仍合法，拼装时接在正文下一段", () => {
  const library = appSettingsSchema.parse({}).mainAgentPrompts;
  const item = library.prompts[0]!;
  const withAppend = { ...item, id: "with-append", appendPrompt: "  追加段落  " };
  const parsed = mainAgentPromptLibrarySchema.safeParse({
    ...library,
    prompts: [item, withAppend],
  });
  assert.equal(parsed.success, true);
  assert.equal(
    parsed.success ? parsed.data.prompts[1]!.appendPrompt : undefined,
    "追加段落",
    "追加提示词按 trim 落库",
  );
  // 该字段出现之前已落盘的条目没有 appendPrompt，严格 schema 不能因此拒绝。
  assert.equal(
    mainAgentPromptLibrarySchema.safeParse({ ...library, prompts: [item] }).success,
    true,
  );
  assert.equal(
    mainAgentPromptLibrarySchema.safeParse({
      ...library,
      prompts: [{ ...item, appendPrompt: "x".repeat(50001) }],
    }).success,
    false,
  );

  assert.equal(composeMainAgentPromptText({ prompt: "BODY" }), "BODY");
  assert.equal(composeMainAgentPromptText({ prompt: "BODY", appendPrompt: "   " }), "BODY");
  assert.equal(
    composeMainAgentPromptText({ prompt: "BODY", appendPrompt: " APPEND " }),
    "BODY\n\nAPPEND",
  );
});

test("canonical intent 保留完整提示词快照与明确默认值", () => {
  const prompt = appSettingsSchema.parse({}).mainAgentPrompts.prompts[0];
  const input = {
    sourceCommandId: "command",
    queueItemId: "queue",
    clientId: "client",
    kind: "sendText",
    text: "review",
    attachments: [],
    delivery: { requested: "queue", admitted: "queue" },
    order: { admissionSeq: 1 },
    steer: { state: "notRequested" },
    dispatch: { state: "queued" },
    admittedAt: 1,
  };
  assert.deepEqual(
    conversationInputIntentSchema.parse({ ...input, mainAgentPrompt: prompt }).mainAgentPrompt,
    prompt,
  );
  assert.equal(
    conversationInputIntentSchema.parse({ ...input, mainAgentPrompt: null }).mainAgentPrompt,
    null,
  );
});

// 升级后同一 RPC 同时承载主提示词与新设置；严格 schema 不得丢掉任一功能。
test("运行时偏好同时接收主提示词、工具搜索和附加目录，并兼容旧 Host", () => {
  const library = appSettingsSchema.parse({}).mainAgentPrompts;
  const base = { nativeSearchEnhancementsEnabled: true, memoryEnabled: false };
  const parsed = zcodeSessionRuntimePreferencesResultSchema.parse({
    ...base,
    mainAgentPrompts: library,
    toolSearchMode: "local",
    additionalDirectories: ["/extra"],
  });
  assert.deepEqual(parsed.mainAgentPrompts, library);
  assert.equal(parsed.toolSearchMode, "local");
  assert.deepEqual(parsed.additionalDirectories, ["/extra"]);
  const legacy = zcodeSessionRuntimePreferencesResultSchema.parse(base);
  assert.equal(legacy.mainAgentPrompts, undefined);
  assert.equal(legacy.toolSearchMode, undefined);
  assert.equal(legacy.additionalDirectories, undefined);
});

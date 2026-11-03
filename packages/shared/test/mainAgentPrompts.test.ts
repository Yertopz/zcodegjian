import assert from "node:assert/strict";
import test from "node:test";
import { appSettingsSchema, appSettingsPatchSchema } from "../src/validationAppSettings.js";
import { mainAgentPromptLibrarySchema, resolveMainAgentPrompt } from "../src/main-agent-prompts.js";
import { zcodeSessionRuntimePreferencesResultSchema } from "../src/zcode-protocol/index.js";
import { conversationInputIntentSchema } from "../src/zcode-protocol-v4/input-intent.js";

test("旧设置初始化示例，保存空列表后读取不会恢复示例", () => {
  const settings = appSettingsSchema.parse({});
  assert.equal(settings.mainAgentPrompts.prompts.length, 3);
  const mainAgentPrompts = { version: 1 as const, defaultId: null, prompts: [] };
  const patch = appSettingsPatchSchema.parse({ mainAgentPrompts });
  assert.deepEqual(
    appSettingsSchema.parse({ ...settings, ...patch }).mainAgentPrompts,
    mainAgentPrompts,
  );
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

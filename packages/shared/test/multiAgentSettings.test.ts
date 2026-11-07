import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MULTI_AGENT_MENTION_LIMIT,
  MAIN_AGENT_CREATOR_ID,
  MULTI_AGENT_MENTION_LIMIT_MAX,
  MULTI_AGENT_MENTION_LIMIT_MIN,
  multiAgentSettingsPatchSchema,
  multiAgentSettingsSchema,
  resolveMultiAgentSettings,
  subagentRuntimeStateSchema,
} from "../src/subagent-runtime-config.js";

/**
 * 「多智能体」设置的模式边界与解析回落。
 *
 * 为什么在这一层钉住：`agents-state.json` 是这条链唯一的状态所有者，
 * 服务层写入前、CLI 每建会话读取时都经过这里的 schema。写坏一个值（0、33、小数）
 * 都会让所有新会话起不来，因此边界必须在最靠内的位置拒绝，而不是靠消费方各自兜底。
 *
 * 三条语义：
 * ① 缺省 = 未开启（旧状态文件天然回落，不伪造「显式关闭」）；
 * ② 越界 @ 次数上限直接拒绝，不做钳制 —— 静默改值会让用户以为设置已生效；
 * ③ 解析函数是唯一默认值来源，消费方不再重复写 `?? 8`。
 *
 * 运行：cd packages/shared && node --import tsx --test test/multiAgentSettings.test.ts
 */

test("缺省状态没有 multiAgent 键，解析后回落到「未开启 + 默认上限 + 主智能体」", () => {
  const parsed = subagentRuntimeStateSchema.parse({
    disabledAgentIds: [],
    builtInModelSelectionOverrides: {},
    pluginAgentModelSelectionOverrides: {},
  });
  assert.equal("multiAgent" in parsed, false);
  assert.deepEqual(resolveMultiAgentSettings(parsed.multiAgent), {
    enabled: false,
    mentionLimit: DEFAULT_MULTI_AGENT_MENTION_LIMIT,
    creatorAgentId: MAIN_AGENT_CREATOR_ID,
  });
});

test("@ 次数上限接受闭区间端点，越界与小数被拒绝", () => {
  for (const limit of [MULTI_AGENT_MENTION_LIMIT_MIN, DEFAULT_MULTI_AGENT_MENTION_LIMIT, 32]) {
    assert.equal(
      multiAgentSettingsSchema.parse({ enabled: true, mentionLimit: limit }).mentionLimit,
      limit,
    );
  }
  for (const limit of [0, MULTI_AGENT_MENTION_LIMIT_MAX + 1, 8.5, Number.NaN]) {
    assert.equal(
      multiAgentSettingsSchema.safeParse({ enabled: true, mentionLimit: limit }).success,
      false,
      `${String(limit)} 不应通过校验`,
    );
  }
});

test("enabled 必填且必须是布尔；未知字段被拒绝（strict）", () => {
  assert.equal(multiAgentSettingsSchema.safeParse({ mentionLimit: 8 }).success, false);
  assert.equal(
    multiAgentSettingsSchema.safeParse({ enabled: "true", mentionLimit: 8 }).success,
    false,
  );
  assert.equal(
    multiAgentSettingsSchema.safeParse({ enabled: true, mentionLimit: 8, extra: 1 }).success,
    false,
  );
});

test("creatorAgentId 允许缺省，空白值被拒绝且写入前 trim", () => {
  assert.equal(
    "creatorAgentId" in multiAgentSettingsSchema.parse({ enabled: true, mentionLimit: 8 }),
    false,
  );
  assert.equal(
    multiAgentSettingsSchema.safeParse({ enabled: true, mentionLimit: 8, creatorAgentId: "  " })
      .success,
    false,
  );
  assert.equal(
    multiAgentSettingsSchema.parse({ enabled: true, mentionLimit: 8, creatorAgentId: " Reviewer " })
      .creatorAgentId,
    "Reviewer",
  );
});

test("补丁可以只带一个字段，字段边界与完整设置一致", () => {
  assert.deepEqual(multiAgentSettingsPatchSchema.parse({ mentionLimit: 3 }), { mentionLimit: 3 });
  assert.deepEqual(multiAgentSettingsPatchSchema.parse({}), {});
  assert.equal(multiAgentSettingsPatchSchema.safeParse({ mentionLimit: 0 }).success, false);
  assert.equal(multiAgentSettingsPatchSchema.safeParse({ mentionLimit: 33 }).success, false);
});

test("解析补丁时缺省字段回落到默认值，而不是 undefined", () => {
  assert.deepEqual(resolveMultiAgentSettings({ enabled: true }), {
    enabled: true,
    mentionLimit: DEFAULT_MULTI_AGENT_MENTION_LIMIT,
    creatorAgentId: MAIN_AGENT_CREATOR_ID,
  });
  assert.equal(resolveMultiAgentSettings(undefined).enabled, false);
});

test("状态文件里的坏 multiAgent 会让整体解析失败，调用方必须自行降级", () => {
  const bad = {
    disabledAgentIds: [],
    builtInModelSelectionOverrides: {},
    pluginAgentModelSelectionOverrides: {},
    multiAgent: { enabled: true, mentionLimit: 999 },
  };
  assert.equal(subagentRuntimeStateSchema.safeParse(bad).success, false);
  // 服务层按字段 safeParse 后丢弃坏值，语义等价于「未设置」，不能让设置页整体打不开。
  assert.equal(multiAgentSettingsSchema.safeParse(bad.multiAgent).success, false);
});

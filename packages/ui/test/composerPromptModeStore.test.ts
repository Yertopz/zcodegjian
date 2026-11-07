import assert from "node:assert/strict";
import test from "node:test";
import { MULTI_AGENT_PROMPT_ID } from "@zcode/shared";
import { isMultiAgentModeActive } from "../src/lib/multiAgentMode.js";
import {
  markComposerPromptScopePending,
  resetComposerPromptScope,
  resolveComposerMultiAgentMode,
  resolveComposerPromptScopeKey,
  syncComposerPromptScope,
  useComposerPromptModeStore,
} from "../src/store/composerPromptModeStore.js";

function readEntry(scopeKey: string) {
  return useComposerPromptModeStore.getState().scopes[scopeKey];
}

test("提示词模式判定：多智能体提示词或团队开关任一成立即为真", () => {
  assert.equal(isMultiAgentModeActive({ mainAgentPromptId: MULTI_AGENT_PROMPT_ID }), true);
  assert.equal(
    isMultiAgentModeActive({ mainAgentPromptId: "coding", multiAgentEnabled: true }),
    true,
  );
  assert.equal(
    isMultiAgentModeActive({ mainAgentPromptId: "coding", multiAgentEnabled: false }),
    false,
  );
  assert.equal(isMultiAgentModeActive({}), false);
});

test("scope 键按工作区身份分键，identity 优先于 path", () => {
  assert.equal(resolveComposerPromptScopeKey("/repo", undefined, "s1"), "/repo::s1");
  assert.equal(resolveComposerPromptScopeKey("/repo", "  remote-1  ", "s1"), "remote-1::s1");
  assert.equal(resolveComposerPromptScopeKey("/repo", "   "), "/repo::");
});

test("选择器投影写入 resolved，缺键与 pending 都回落到团队开关", () => {
  const scopeKey = resolveComposerPromptScopeKey("/repo", undefined, "s-projection");
  assert.equal(readEntry(scopeKey), undefined);

  // 缺键：等价于 pending，只看团队开关。
  assert.equal(resolveComposerMultiAgentMode(readEntry(scopeKey), true), true);
  assert.equal(resolveComposerMultiAgentMode(readEntry(scopeKey), false), false);

  syncComposerPromptScope(scopeKey, MULTI_AGENT_PROMPT_ID);
  assert.deepEqual(readEntry(scopeKey), {
    status: "resolved",
    mainAgentPromptId: MULTI_AGENT_PROMPT_ID,
  });
  // resolved 且是多智能体提示词：即使开关关掉，当前输入框仍处于多智能体模式。
  assert.equal(resolveComposerMultiAgentMode(readEntry(scopeKey), false), true);

  syncComposerPromptScope(scopeKey, "coding");
  assert.equal(resolveComposerMultiAgentMode(readEntry(scopeKey), true), true);
  assert.equal(resolveComposerMultiAgentMode(readEntry(scopeKey), false), false);
});

test("新建任务把 scope 打回 pending，不沿用上一个会话的提示词", () => {
  const scopeKey = resolveComposerPromptScopeKey("/repo", undefined, "s-reset");
  syncComposerPromptScope(scopeKey, MULTI_AGENT_PROMPT_ID);
  assert.equal(resolveComposerMultiAgentMode(readEntry(scopeKey), false), true);

  resetComposerPromptScope(scopeKey);
  assert.deepEqual(readEntry(scopeKey), { status: "pending", mainAgentPromptId: null });
  // pending 语义 = 当前提示词未定，因此回落到团队开关（这里是关闭）。
  assert.equal(resolveComposerMultiAgentMode(readEntry(scopeKey), false), false);
  assert.equal(resolveComposerMultiAgentMode(readEntry(scopeKey), true), true);
});

test("同值写入不改变状态对象，避免投影 effect 自唤醒", () => {
  const scopeKey = resolveComposerPromptScopeKey("/repo", undefined, "s-idempotent");
  syncComposerPromptScope(scopeKey, "coding");
  const first = useComposerPromptModeStore.getState();
  syncComposerPromptScope(scopeKey, "coding");
  assert.equal(useComposerPromptModeStore.getState(), first);

  // 不同 scope 各自独立，互不覆盖。
  const otherKey = resolveComposerPromptScopeKey("/repo", undefined, "s-other");
  markComposerPromptScopePending(otherKey);
  assert.deepEqual(readEntry(scopeKey), { status: "resolved", mainAgentPromptId: "coding" });
  assert.deepEqual(readEntry(otherKey), { status: "pending", mainAgentPromptId: null });
});

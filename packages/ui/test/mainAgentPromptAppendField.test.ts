import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 「追加提示词」是正文之外的第二块编辑区，不能与正文共用同一个 state 槽位，
 * 也不能只改文案不改数据（那样用户填了、保存后消失）。
 * 这个组件是 222 行的表单 + 列表，static markup 断言拿不到受控 state 的写入路径，
 * 因此按仓库既有做法做结构断言：位置（在正文之后）、绑定字段、新建初值、i18n 键。
 */
const sectionPath = fileURLToPath(
  new URL("../src/settings/MainAgentPromptsSection.tsx", import.meta.url),
);
const zhPath = fileURLToPath(new URL("../src/i18n/locales/zh-CN.ts", import.meta.url));
const enPath = fileURLToPath(new URL("../src/i18n/locales/en-US.ts", import.meta.url));

const section = readFileSync(sectionPath, "utf8");

test("编辑表单在正文下方提供追加提示词输入框，并写入 appendPrompt", () => {
  const bodyIndex = section.indexOf('data-testid="main-agent-prompt-body"');
  const appendIndex = section.indexOf('data-testid="main-agent-prompt-append"');
  assert.ok(bodyIndex > 0, "正文输入框必须存在");
  assert.ok(appendIndex > bodyIndex, "追加提示词输入框必须排在正文之后");
  const appendBlock = section.slice(appendIndex, appendIndex + 600);
  assert.match(appendBlock, /value=\{draft\.appendPrompt \?\? ""\}/);
  assert.match(appendBlock, /setDraft\(\{ \.\.\.draft, appendPrompt: event\.target\.value \}\)/);
  assert.match(appendBlock, /maxLength=\{50000\}/);
});

test("新建提示词时追加提示词初始为空，保存走同一 schema 校验", () => {
  assert.match(
    section,
    /setDraft\(\{ id: uuidv7\(\), name: "", description: "", prompt: "", appendPrompt: "" \}\)/,
  );
  assert.match(section, /mainAgentPromptSchema\.safeParse\(draft\)/);
});

test("中英文都提供追加提示词的标题与说明，标题明确是最新追加段", () => {
  for (const locale of [zhPath, enPath]) {
    const source = readFileSync(locale, "utf8");
    assert.match(source, /"settings\.mainAgentPrompts\.append":/, `${locale} 缺 append 标题`);
    assert.match(
      source,
      /"settings\.mainAgentPrompts\.appendHint":/,
      `${locale} 缺 appendHint 说明`,
    );
  }
  assert.match(
    readFileSync(zhPath, "utf8"),
    /"settings\.mainAgentPrompts\.append": "追加提示词（可选）"/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODING_PLAN_PROVIDER_SPECS,
  PRESET_PROVIDER_SPECS,
} from "../src/settings/model-provider-section/constants.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import enUS from "../src/i18n/locales/en-US.js";

/**
 * 「添加供应商 → Codex 登录」入口的接线回归测试。
 *
 * 这个入口由四处共同决定：模板选择页的卡片与智谱模板过滤、表单组件的 testId、
 * Host 侧 `loginCodex` 的调用点、中英双语文案。任一处漏改，用户看到的是
 * 「卡片点了没反应」或「表单打开是空白标题」。
 *
 * 分区渲染需要浏览器 harness，单测不承担 UI 交互验证，因此卡片/表单的
 * DOM 归属用源码断言兜底；文案与智谱入口的移除用真实取值断言。
 *
 * 运行：cd packages/ui && node --import tsx --test test/settingsCodexLoginEntry.test.ts
 */

const here = dirname(fileURLToPath(import.meta.url));
const pickerPath = resolve(
  here,
  "../src/settings/model-provider-section/ProviderTemplatePicker.tsx",
);
const formPath = resolve(here, "../src/settings/model-provider-section/CodexLoginForm.tsx");
const pickerSource = readFileSync(pickerPath, "utf8");
const formSource = readFileSync(formPath, "utf8");

test("智谱内置入口已从供应商预设清单移除，只保留 Z.ai", () => {
  assert.deepEqual(
    PRESET_PROVIDER_SPECS.map((spec) => spec.displayName),
    ["Z.ai"],
    "预设清单里不应再有 BigModel / Z.ai API 之类智谱行",
  );
  assert.equal(
    PRESET_PROVIDER_SPECS.some((spec) => /bigmodel/i.test(spec.id)),
    false,
    "预设清单残留 BigModel id",
  );
  assert.equal(
    CODING_PLAN_PROVIDER_SPECS.some((spec) => /bigmodel/i.test(spec.id)),
    false,
    "Coding Plan 清单残留 BigModel id",
  );
});

test("模板网格不再按智谱/其他分组，智谱系模板在渲染前被滤掉", () => {
  assert.equal(
    /templateGroup\.|data-provider-template-group|"zhipu"/u.test(pickerSource),
    false,
    "添加供应商不应再出现智谱分组",
  );
  const hiddenIdsBlock = pickerSource.match(/const hiddenTemplateIds = \[[\s\S]*?\];/u)?.[0] ?? "";
  for (const templateId of [
    "bigmodel-api",
    "zai-api",
    "bigmodel-standard-api",
    "zai-standard-api",
  ]) {
    assert.ok(
      hiddenIdsBlock.includes(`"${templateId}"`),
      `智谱模板 ${templateId} 必须落在过滤名单里`,
    );
  }
  assert.match(pickerSource, /visibleTemplates\.map\(/u, "网格必须按过滤后的模板渲染");
  assert.equal(
    "settings.modelProvider.templateGroup.zhipu" in zhCN,
    false,
    "分组文案已无消费方，应随之删除",
  );
});

test("Codex 登录卡片是网格第一张，带独立 testId 与开关回调", () => {
  assert.match(pickerSource, /onCodexLogin/u, "模板选择页缺少 onCodexLogin 回调");
  assert.match(
    pickerSource,
    /id: "settings\.modelProvider\.codexLogin"/u,
    "卡片标题必须走 codexLogin 文案",
  );
  assert.match(
    pickerSource,
    /testId\(TID_MODEL_PROVIDER_TEMPLATE_ITEM, "codex-login"\)/u,
    "卡片 testId 后缀应为 codex-login",
  );
  const codexCardIndex = pickerSource.indexOf('"codex-login"');
  const customCardIndex = pickerSource.indexOf('TID_MODEL_PROVIDER_TEMPLATE_ITEM, "custom"');
  assert.ok(
    codexCardIndex > 0 && codexCardIndex < customCardIndex,
    "Codex 登录卡片要排在自定义供应商卡片之前",
  );
  assert.match(pickerSource, /<CodexLoginForm/u, "点击卡片后必须渲染 CodexLoginForm");
  assert.match(
    pickerSource,
    /"settings\.modelProvider\.codexLoginFailed"/u,
    "登录失败要能复用详情区反馈横幅",
  );
});

test("表单只收集三项可选输入，代理留空表示不启用专属代理", () => {
  for (const testIdSuffix of [
    "codex-login-auth-file",
    "codex-login-model",
    "codex-login-proxy",
    "codex-login-submit",
  ]) {
    assert.match(
      formSource,
      new RegExp(`"${testIdSuffix}"`, "u"),
      `表单缺少 testId 后缀 ${testIdSuffix}`,
    );
  }
  assert.match(
    formSource,
    /\.\.\.\(proxy \? \{ proxyUrl: proxy \} : \{\}\)/u,
    "空代理必须被剔除，不能提交空字符串",
  );
  assert.match(
    formSource,
    /id: "settings\.modelProvider\.codexProxyLabel"/u,
    "代理输入框必须使用 codexProxyLabel 文案",
  );
});

test("中英双语都提供 Codex 登录的全部文案", () => {
  const keys = [
    "settings.modelProvider.codexLogin",
    "settings.modelProvider.codexLoginTitle",
    "settings.modelProvider.codexLoginHint",
    "settings.modelProvider.codexAuthFileLabel",
    "settings.modelProvider.codexAuthFilePlaceholder",
    "settings.modelProvider.codexModelLabel",
    "settings.modelProvider.codexModelPlaceholder",
    "settings.modelProvider.codexProxyLabel",
    "settings.modelProvider.codexProxyPlaceholder",
    "settings.modelProvider.codexProxyHint",
    "settings.modelProvider.codexLoginSubmit",
    "settings.modelProvider.codexLoginSubmitting",
    "settings.modelProvider.codexLoginCancel",
    "settings.modelProvider.codexLoginFailed",
  ] as const;
  for (const key of keys) {
    assert.equal(typeof zhCN[key], "string", `中文缺少 ${key}`);
    assert.equal(typeof enUS[key], "string", `英文缺少 ${key}`);
    assert.notEqual(zhCN[key], "", `中文 ${key} 为空`);
    assert.notEqual(enUS[key], "", `英文 ${key} 为空`);
  }
  assert.equal(zhCN["settings.modelProvider.codexLogin"], "Codex 登录");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isSettingsSectionEnabled, resolveSettingsSection } from "../src/lib/settingsNavigation.js";
import { SETTINGS_SECTIONS, createSettingsPageConfig } from "../src/settings/settingsPageConfig.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import enUS from "../src/i18n/locales/en-US.js";

/**
 * 「多智能体」分区的接线回归测试。
 *
 * 新增 SettingsSectionId 必须同时改四处（类型白名单 / 运行时可观测白名单 / 侧边栏注册表 /
 * SettingsPage 渲染分支链），漏改的表现为「侧边栏点开空白」或「跳转意图被静默丢弃」。
 * 前三处由本文件锁死，渲染分支与 i18n 文案用源码断言兜底（分区渲染需要浏览器 harness，
 * 单测不承担 UI 交互验证）。
 *
 * 运行：cd packages/ui && node --import tsx --test test/settingsMultiAgentSection.test.ts
 */

test("multiAgent 分区已注册，且紧跟子智能体、同属 Agent 能力组", () => {
  const index = SETTINGS_SECTIONS.findIndex((candidate) => candidate.id === "multiAgent");
  assert.notEqual(index, -1, "SETTINGS_SECTIONS 里缺少 multiAgent 分区");
  const section = SETTINGS_SECTIONS[index]!;
  assert.equal(section.groupId, "agentCapabilities");
  assert.equal(section.titleId, "settings.multiAgent.title");
  assert.equal(
    SETTINGS_SECTIONS[index - 1]?.id,
    "subagents",
    "多智能体必须紧跟子智能体，否则用户看不出两者的层级关系",
  );
});

test("multiAgent 不在隐藏集里，桌面与 Web 都能打开", () => {
  assert.equal(isSettingsSectionEnabled("multiAgent"), true);
  assert.equal(resolveSettingsSection("multiAgent"), "multiAgent");
  assert.ok(createSettingsPageConfig({}).settingsSections.some((s) => s.id === "multiAgent"));
  assert.ok(
    createSettingsPageConfig({ isDesktop: true }).settingsSections.some(
      (s) => s.id === "multiAgent",
    ),
  );
});

test("中文与英文都提供了分区文案，占位符成对出现", () => {
  const keys = [
    "settings.multiAgent.title",
    "settings.multiAgent.enabled.label",
    "settings.multiAgent.enabled.description",
    "settings.multiAgent.mentionLimit.label",
    "settings.multiAgent.mentionLimit.description",
    "settings.multiAgent.mentionLimitInvalid",
    "settings.multiAgent.creator.label",
    "settings.multiAgent.creator.description",
    "settings.multiAgent.creator.main",
    "settings.multiAgent.takesEffectHint",
    "settings.multiAgent.saveFailed",
    "settings.multiAgent.loadFailed",
  ] as const;
  for (const key of keys) {
    assert.ok((zhCN as Record<string, string>)[key], `zh-CN 缺少 ${key}`);
    assert.ok((enUS as Record<string, string>)[key], `en-US 缺少 ${key}`);
  }
  for (const key of [
    "settings.multiAgent.mentionLimit.description",
    "settings.multiAgent.mentionLimitInvalid",
  ] as const) {
    assert.match((zhCN as Record<string, string>)[key]!, /\{min\}.*\{max\}/u, `${key} zh-CN`);
    assert.match((enUS as Record<string, string>)[key]!, /\{min\}.*\{max\}/u, `${key} en-US`);
  }
});

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(here, "../src/SettingsPage.tsx"), "utf8");
const sectionSource = readFileSync(resolve(here, "../src/settings/MultiAgentSection.tsx"), "utf8");
const hookSource = readFileSync(resolve(here, "../src/hooks/useMultiAgentConfig.ts"), "utf8");
const teamSectionSource = readFileSync(
  resolve(here, "../src/settings/TeamMembersSection.tsx"),
  "utf8",
);
const teamFormSource = readFileSync(resolve(here, "../src/settings/TeamMemberForm.tsx"), "utf8");
const subagentsSource = readFileSync(resolve(here, "../src/settings/SubagentsSection.tsx"), "utf8");

test("SettingsPage 把 multiAgent 分支渲染到 MultiAgentSection", () => {
  assert.match(
    pageSource,
    /activeSection === "multiAgent" \?[\s\S]{0,120}<MultiAgentSection\b/u,
    "SettingsPage 没有 multiAgent 渲染分支",
  );
});

test("分区只通过 hook 访问服务，不直接拿 service", () => {
  assert.match(sectionSource, /useMultiAgentConfig\(\)/u);
  assert.doesNotMatch(
    sectionSource,
    /useServices\(/u,
    "分区不得绕过 hooks 直接访问服务（架构规则：组件通过 hooks 访问服务）",
  );
  assert.match(
    hookSource,
    /subagentsService\.setMultiAgentConfig\(\{ patch \}\)/u,
    "hook 必须走服务写入，不能在 UI 侧自建状态所有者",
  );
});

test("@ 次数上限的越界值不发写请求", () => {
  assert.match(sectionSource, /MULTI_AGENT_MENTION_LIMIT_MIN/u);
  assert.match(sectionSource, /MULTI_AGENT_MENTION_LIMIT_MAX/u);
  assert.match(
    sectionSource,
    /if \(!isValid\) \{/u,
    "越界输入必须就地回落并提示，不能把非法值写进 agents-state.json",
  );
});

test("团队成员分区挂载在「多智能体」里，成员只在 kind === team 时列出", () => {
  assert.match(
    sectionSource,
    /<TeamMembersSection\b[^>]*workspacePath=\{workspacePath\}/u,
    "多智能体分区必须挂载团队成员分区，否则用户找不到成员入口",
  );
  assert.match(teamSectionSource, /agent\.kind === "team"/u);
  assert.match(teamFormSource, /kind: "team"/u, "成员表单写入时必须带 kind: team 标记");
});

test("团队成员只有一条写入路径：SubagentsSection 只跳转不编辑", () => {
  // 头像必须在拿到真实 agent id 之后写，否则改名会留下孤儿头像。
  assert.match(
    teamSectionSource,
    /subagentsService\.setAgentAvatar\(\{ agentId: written\.agent\.id/u,
  );
  assert.match(
    subagentsSource,
    /setPendingSettingsSectionIntent\("multiAgent"\)/u,
    "子智能体页的团队分组成员只能引导去多智能体分区编辑",
  );
  assert.match(subagentsSource, /renderAgentList\(groupedAgents\.team, true\)/u);
});

test("团队成员文案中英成对存在", () => {
  const keys = [
    "settings.subagents.group.team.manage",
    "settings.multiAgent.teamMembers.title",
    "settings.multiAgent.teamMembers.empty",
    "settings.multiAgent.teamMembers.add",
    "settings.multiAgent.teamMembers.edit",
    "settings.multiAgent.teamMembers.saveFailed",
    "settings.multiAgent.teamMembers.delete.title",
    "settings.multiAgent.teamMembers.delete.description",
    "settings.multiAgent.teamMembers.enabled.label",
    "settings.multiAgent.teamMembers.form.name.label",
    "settings.multiAgent.teamMembers.form.description.label",
    "settings.multiAgent.teamMembers.form.color.label",
    "settings.multiAgent.teamMembers.form.model.label",
    "settings.multiAgent.teamMembers.form.model.inherit",
    "settings.multiAgent.teamMembers.form.tools.label",
    "settings.multiAgent.teamMembers.form.permissionMode.label",
    "settings.multiAgent.teamMembers.form.systemPrompt.label",
    "settings.multiAgent.teamMembers.form.avatar.label",
    "settings.multiAgent.teamMembers.form.avatar.upload",
    "settings.multiAgent.teamMembers.form.avatar.clear",
    "settings.multiAgent.teamMembers.form.avatar.presets",
    "settings.multiAgent.teamMembers.form.avatar.unsupported",
    "settings.multiAgent.teamMembers.form.avatar.tooLarge",
    "settings.multiAgent.teamMembers.form.avatar.readFailed",
    "settings.multiAgent.teamMembers.form.validation.nameRequired",
    "settings.multiAgent.teamMembers.form.validation.nameCharacters",
    "settings.multiAgent.teamMembers.form.validation.nameLength",
    "settings.multiAgent.teamMembers.form.validation.descriptionRequired",
    "settings.multiAgent.teamMembers.form.validation.promptRequired",
    "settings.multiAgent.teamMembers.form.validation.toolsRequired",
  ] as const;
  for (const key of keys) {
    assert.ok((zhCN as Record<string, string>)[key], `zh-CN 缺少 ${key}`);
    assert.ok((enUS as Record<string, string>)[key], `en-US 缺少 ${key}`);
  }
});

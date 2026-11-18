import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * F11(账户菜单查看套餐 + 复制用户 ID)接线回归。
 *
 * 背景：上游 v3.15.1 在 WorkspaceSidebarFooter 的账户菜单头部新增套餐 badge、
 * 用户 ID 展示与复制按钮。CE 按此口径移植(Apache-2.0),但刻意不移植同批的
 * rewards/邀请好友入口(F1, 分类 C)。
 *
 * 本组用源码断言(仓库 mobileNarrowLayout.test.ts 的既有模式, 零渲染依赖)钉住：
 * 1. 菜单头部包含 profile-menu-header / profile-menu-plan / copy-user-id 结构；
 * 2. copyUserId 走 navigator.clipboard 并在成功/失败两条路径上都 toast(禁止静默降级)；
 * 3. 套餐 badge 只在菜单头部出现一次, footer 触发器不再冗余展示(避免两处状态)；
 * 4. 两份 locale 都补齐 4 条键；
 * 5. 不引入 rewards/邀请入口。
 *
 * 运行：cd packages/ui && node --import tsx --test test/workspaceSidebarFooterAccountMenu.test.ts
 */

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(join(packageRoot, relativePath), "utf8");
}

const footerSource = readSource("src/WorkspaceSidebarFooter.tsx");
const zhSource = readSource("src/i18n/locales/zh-CN.ts");
const enSource = readSource("src/i18n/locales/en-US.ts");

test("F11-a: 账户菜单头部包含套餐 badge 与用户 ID 展示结构", () => {
  assert.match(footerSource, /data-testid="profile-menu-header"/);
  assert.match(footerSource, /data-testid="profile-menu-plan"/);
  assert.match(footerSource, /data-testid="profile-menu-id"/);
  assert.match(footerSource, /data-testid="profile-menu-name"/);
  // prettier 折行：JSX 属性可能跨行，容忍空白（语义不变）。
  assert.match(footerSource, /<WorkspaceSidebarFooterPlanBadge\s+state=\{usageSummaryState\}/);
  assert.match(footerSource, /sidebar\.profile\.accountId/);
});

test("F11-b: 复制用户 ID 走 clipboard, 成功与失败都明示 toast", () => {
  assert.match(footerSource, /await navigator\.clipboard\.writeText\(user\.id\)/);
  // 失败路径必须存在(静默降级是唯一不被允许的)
  assert.match(footerSource, /catch \{[\s\S]*sidebar\.profile\.userIdCopyFailed/);
  assert.match(footerSource, /sidebar\.profile\.userIdCopied/);
  // 复制按钮触发的是 copyUserId, 不是直接关菜单
  assert.match(footerSource, /void copyUserId\(\)/);
  assert.match(footerSource, /data-testid="copy-user-id"/);
});

test("F11-c: 套餐 badge 只在菜单头部出现一次, footer 触发器不再冗余展示", () => {
  // prettier 折行：JSX 属性可能跨行，容忍空白（语义不变）。
  const occurrences = footerSource.match(
    /<WorkspaceSidebarFooterPlanBadge\s+state=\{usageSummaryState\}/gu,
  );
  assert.equal(occurrences?.length, 1, "套餐 badge 只应有一处渲染点(账户菜单头部)");
});

test("F11-d: 两份 locale 都有这 4 条键", () => {
  const keys = [
    "sidebar.profile.accountId",
    "sidebar.profile.copyUserId",
    "sidebar.profile.userIdCopied",
    "sidebar.profile.userIdCopyFailed",
  ];
  for (const key of keys) {
    assert.ok(footerSource.includes(key), key);
    assert.ok(zhSource.includes(`"${key}"`), `zh-CN 缺键: ${key}`);
    assert.ok(enSource.includes(`"${key}"`), `en-US 缺键: ${key}`);
  }
});

test("F11-e: 不引入 rewards / 邀请好友入口(F1 分类 C, 不搬)", () => {
  assert.equal(footerSource.includes("openRewards"), false);
  assert.equal(footerSource.includes("RewardsProvider"), false);
  assert.equal(footerSource.includes("rewards.menuTitle"), false);
  assert.equal(footerSource.includes("Gift"), false, "Gift 图标属 rewards 入口, 不搬");
});

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

/**
 * 群聊成员消息卡骨架（真实组件 + 真实 Intl provider + react-dom/server）。
 *
 * 这张卡有两个消费者（SendMessage 群聊消息、子智能体回复预览），骨架一旦漂移，
 * 「身份头一行 + 正文与名字列对齐 + 引用条 + 状态页脚」这四件事会在两处各走各的。
 * 所以断言直接盯渲染结果：单行身份（`名字 · 简介`）、可选的 `<time>`、引用条、
 * 状态页脚，以及「没有简介就不出中点」这条容易退化的边界。
 *
 * 反向验证：把 TeamMemberIdentityRow 的 descriptionPlacement 改回默认 "below"，
 * 第一条的中点断言变红；把 timeLabel 直接渲染成字符串常量，第三条变红。
 *
 * 运行：cd packages/ui && node --import tsx --test test/groupChatMemberCard.test.ts
 */

async function renderCard(props: {
  name?: string;
  description?: string;
  timeLabel?: string;
  quoteLine?: string;
  quoteTitle?: string;
  footerText?: string;
  avatar?: { kind: "emoji"; value: string };
}): Promise<string> {
  const [{ GroupChatMemberCard }, { ZCodeIntlProvider }] = await Promise.all([
    import("../src/components/team/GroupChatMemberCard.js"),
    import("../src/i18n/IntlProvider.js"),
  ]);
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(GroupChatMemberCard, {
        rootTestId: "agent-reply-preview",
        member: {
          name: props.name ?? "Codex",
          ...(props.description === undefined ? {} : { description: props.description }),
          ...(props.avatar === undefined ? {} : { avatar: props.avatar }),
        },
        ...(props.timeLabel === undefined ? {} : { timeLabel: props.timeLabel }),
        ...(props.quoteLine === undefined ? {} : { quoteLine: props.quoteLine }),
        ...(props.quoteTitle === undefined ? {} : { quoteTitle: props.quoteTitle }),
        ...(props.footerText === undefined
          ? {}
          : { footer: createElement("span", null, props.footerText) }),
        children: createElement("p", null, "正文"),
      } as never),
    ),
  );
}

test("DOM：身份头单行渲染 名字 · 简介，并保留头像", async () => {
  const html = await renderCard({
    name: "Codex",
    description: "接手验收",
    avatar: { kind: "emoji", value: "🛠️" },
  });
  assert.ok(html.includes("Codex"), "名字必须进 DOM");
  assert.ok(html.includes("接手验收"), "简介必须进 DOM");
  assert.ok(html.includes(">·<") || html.includes("·"), "名字与简介之间必须有中点分隔");
  assert.ok(html.includes("🛠️"), "头像必须走 TeamMemberAvatar 的三级回退");
  assert.ok(html.includes('data-group-chat-member="Codex"'), "成员身份需要机器可读属性");
  assert.ok(
    html.includes("chat-group-chat-identity-Codex"),
    "身份行必须复用 TeamMemberIdentityRow",
  );
});

test("DOM：没有简介时不渲染中点（不留孤立分隔符）", async () => {
  const html = await renderCard({ name: "小闪" });
  assert.ok(html.includes("小闪"));
  assert.equal(html.includes("·"), false, "无简介时不得出现中点");
});

test("DOM：时间进入 <time>，缺省时不占位", async () => {
  const withTime = await renderCard({ timeLabel: "11:46" });
  assert.ok(withTime.includes("<time"), "时间必须是机器可读的 <time>");
  assert.ok(withTime.includes("11:46"), "时间文案必须进 DOM");

  const withoutTime = await renderCard({});
  assert.equal(withoutTime.includes("<time"), false, "没有可用时间戳时不得渲染空 <time>");
});

test("DOM：引用条带 testid 与全文 tooltip，内容缩进在正文列", async () => {
  const html = await renderCard({
    quoteLine: "你：@全体 你们好",
    quoteTitle: "@全体 你们好",
  });
  assert.ok(
    html.includes("chat-group-chat-message-quote-agent-reply-preview"),
    "引用条必须有 testid",
  );
  assert.ok(html.includes("你：@全体 你们好"), "引用文案必须进 DOM");
  assert.ok(html.includes('title="@全体 你们好"'), "引条最多两行，全文必须留在 tooltip");
  assert.ok(html.includes("line-clamp-2"), "引条按两行截断");

  const withoutQuote = await renderCard({});
  assert.equal(
    withoutQuote.includes("chat-group-chat-message-quote"),
    false,
    "无触发消息时不出引条",
  );
});

test("DOM：页脚只在有内容时渲染（状态 + 动作），否则不留空白区块", async () => {
  const withFooter = await renderCard({ footerText: "正在干活…" });
  assert.ok(withFooter.includes("chat-group-chat-message-status-agent-reply-preview"));
  assert.ok(withFooter.includes("正在干活…"));

  const withoutFooter = await renderCard({});
  assert.equal(withoutFooter.includes("chat-group-chat-message-status"), false);
});

// 群聊成员消息卡：单行身份头（头像 + `名字 · 简介` + 右上时间）→ 引用条 → 正文 → 状态页脚。
//
// 为什么抽成一处：这张卡有两个来源 —— SendMessage 的群聊消息（ToolCallBlocks/renderers/
// send-message.tsx）与子智能体回复预览（v4/ConversationAgentReply.tsx）。两边各自拼外壳时
// 头像列宽、正文缩进、时间位置会各走各的，改参考图的对齐就得改两遍。
//
// 身份与头像仍然只有既有实现：TeamMemberIdentityRow（descriptionPlacement="inline"）与
// TeamMemberAvatar。本文件只负责骨架与间距。
import type { ReactNode } from "react";
import type { AgentAvatar } from "@zcode/shared";
import {
  testId,
  TID_CHAT_GROUP_CHAT_MESSAGE_QUOTE,
  TID_CHAT_GROUP_CHAT_MESSAGE_STATUS,
} from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { TeamMemberIdentityRow } from "@/components/team/TeamMemberIdentityRow.js";

export interface GroupChatMemberCardMember {
  name: string;
  description?: string;
  avatar?: AgentAvatar | null;
  color?: string | null;
}

export interface GroupChatMemberCardProps {
  /** 卡片根节点 testid 的完整取值（消息卡用 toolCallId，回复卡沿用既有 id）。 */
  rootTestId: string;
  member: GroupChatMemberCardMember;
  /** 右上角时间；已由 messageTimeLabel 格式化，缺省不占位。 */
  timeLabel?: string | null;
  /** 已格式化的引用行（`你：<触发消息>`）；缺省不渲染引条。 */
  quoteLine?: string;
  /** 引用行全文 tooltip（引条本身最多两行）。 */
  quoteTitle?: string;
  /** 页脚：运行状态与动作按钮。缺省不占位。 */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function GroupChatMemberCard({
  rootTestId,
  member,
  timeLabel,
  quoteLine,
  quoteTitle,
  footer,
  children,
  className,
}: GroupChatMemberCardProps) {
  return (
    <section
      data-testid={rootTestId}
      data-group-chat-member={member.name}
      className={cn("min-w-0 rounded-xl bg-panel px-3.5 py-3", className)}
    >
      {/* items-center 而非 baseline：身份行是 flex 容器、首个子项是头像（替换元素），
          baseline 对齐会退化成「头像底边 + 时间」，名字与时间反而错位。 */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <TeamMemberIdentityRow
          name={member.name}
          description={member.description}
          avatar={member.avatar}
          color={member.color}
          variant="inline"
          descriptionPlacement="inline"
          className="min-w-0"
        />
        {timeLabel ? (
          // 时间不能只靠位置表达（DESIGN.md：状态必须文案 + 颜色双通道）；
          // 这里用 <time> 承载机器可读语义，视觉上弱化。
          <time className="shrink-0 text-ui-2xs tabular-nums text-foreground-subtlest">
            {timeLabel}
          </time>
        ) : null}
      </div>
      {/* pl-6 = 头像 size-4 + inline 身份的 gap-2：正文与名字列对齐（参考图的缩进）。 */}
      <div className="mt-1.5 min-w-0 space-y-1.5 pl-6">
        {quoteLine ? (
          // flex 而非 inline 兄弟节点：`line-clamp-2` 会把引用文本变成 -webkit-box
          // （块级），箭头那行就会单独占一行、引文整体下移一行（实测群聊回复卡如此）。
          <div
            data-testid={testId(TID_CHAT_GROUP_CHAT_MESSAGE_QUOTE, rootTestId)}
            title={quoteTitle}
            className="flex min-w-0 items-start gap-1 rounded-md bg-surface px-2.5 py-1.5 text-ui-sm text-foreground-subtle"
          >
            <span aria-hidden="true" className="shrink-0 text-foreground-subtlest">
              ↳
            </span>
            <span className="line-clamp-2 min-w-0 whitespace-pre-wrap break-words">
              {quoteLine}
            </span>
          </div>
        ) : null}
        {children}
      </div>
      {footer ? (
        <div
          data-testid={testId(TID_CHAT_GROUP_CHAT_MESSAGE_STATUS, rootTestId)}
          className="mt-2 flex min-w-0 items-center gap-2 pl-6 text-ui-sm text-foreground-subtle"
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}

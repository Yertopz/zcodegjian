import { useEffect, useState, type ReactNode } from "react";
import { BotIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { GroupChatMemberCard } from "@/components/team/GroupChatMemberCard.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { selectAgentReplyPreview } from "@/v4/collaborationReplyPreview.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import { resolveGroupChatMemberByName } from "@/v4/groupChatMemberJoin.js";
import { formatMessageTimeLabel } from "@/v4/messageTimeLabel.js";
import type { SessionDataLayer, SessionLease } from "@/v4/sessionDataLayer.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

/** 从现有子会话租约显示消息；不复制运行状态，也不创建新的消息来源。 */
export function ConversationAgentReply({
  childSessionId,
  startedAt,
  agentName,
  context,
  running = false,
  onOpen,
  emptyFallback,
}: {
  childSessionId: string;
  startedAt: number;
  agentName: string;
  context: ConversationRowRenderContext;
  /** 子会话是否仍在跑：决定「还没有文字」时是否先立身份卡。 */
  running?: boolean;
  onOpen?: () => void;
  /**
   * 拿不到回复文本、且子会话没有在跑时渲染什么。群聊成员行（SubagentRowView）传原来的
   * 一行摘要做降级，避免回复卡缺席时整行变成空白；不传则整卡不渲染（同旧行为）。
   */
  emptyFallback?: ReactNode;
}) {
  const { layer } = useV4Conversation();
  const { intl, locale } = useZCodeIntl();
  const [binding, setBinding] = useState<{ layer: SessionDataLayer; lease: SessionLease } | null>(
    null,
  );
  // 同路径远程工作区可使用不同 Host；切换 layer 时不能渲染上一个 Host 的快照。
  const lease =
    binding?.layer === layer && binding.lease.sessionId === childSessionId ? binding.lease : null;
  const state = useConversationProjection(lease);

  useEffect(() => {
    const nextLease = layer.acquire(childSessionId);
    setBinding({ layer, lease: nextLease });
    return () => nextLease.release();
  }, [childSessionId, layer]);

  const reply =
    state.status === "live" && state.snapshot?.sessionId === childSessionId
      ? selectAgentReplyPreview(state.snapshot.rows.window, startedAt)
      : null;

  // 群聊视图里回复卡的头部就是成员身份（头像 + `名字 · 简介` + 时间）；非群聊会话沿用
  // 机器人图标 + 名字，避免把普通子智能体回复说成「团队成员」。
  const member = context.groupChatActive
    ? resolveGroupChatMemberByName(agentName, context.groupChatMembers)
    : undefined;

  // 成员已派单但子会话还没产出第一段文字时也要立卡：只按 reply 文本决定渲染，
  // 会让「成员正在干活」在会话里完全不可见，用户看到的就只剩工具卡和一行状态文本。
  if (!reply && !(member && running)) return emptyFallback ?? null;

  const body = reply ? (
    <div className="max-h-60 overflow-auto text-ui-base" tabIndex={0}>
      <MessageResponse
        streaming={reply.streaming}
        workspacePath={context.workspacePath}
        workspaceIdentity={context.workspaceIdentity}
        workspaceRemoteSessionId={context.workspaceRemoteSessionId}
        sessionId={childSessionId}
        theme={context.theme}
        codePreviewSettings={context.codePreviewSettings}
        onOpenCodeViewer={context.onOpenCodeViewer}
        onOpenFileLink={context.onOpenFileLink}
        onOpenExternalUrl={context.onOpenBrowserUrl}
        readAttachment={context.readAttachment}
      >
        {reply.text}
      </MessageResponse>
    </div>
  ) : null;

  if (member) {
    const working = running || reply?.streaming === true;
    // 引用条只显示真实用户消息：群聊里触发成员的是用户那句 @，不是成员的派单提示词。
    const quoteText = context.turnUserInputText?.trim() || undefined;
    const quoteLine = quoteText
      ? intl.formatMessage({ id: "chat.groupChat.members.quoteFromUser" }, { text: quoteText })
      : undefined;
    const footer =
      working || onOpen ? (
        <>
          {working ? (
            <span className="shrink-0 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "chat.groupChat.members.working" })}
            </span>
          ) : null}
          {onOpen ? (
            <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
              {intl.formatMessage({ id: "chat.groupChat.members.viewProcess" })}
            </Button>
          ) : null}
        </>
      ) : undefined;

    return (
      <GroupChatMemberCard
        rootTestId="agent-reply-preview"
        member={member}
        timeLabel={formatMessageTimeLabel(startedAt, locale, intl)}
        quoteLine={quoteLine}
        quoteTitle={quoteText}
        footer={footer}
        className="mt-2"
      >
        {body}
      </GroupChatMemberCard>
    );
  }

  const replyLabel = intl.formatMessage({
    id:
      reply?.streaming === true ? "chat.collaboration.replyStreaming" : "chat.collaboration.reply",
  });

  return (
    <section
      data-testid="agent-reply-preview"
      className="mt-2 min-w-0 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <div className="mb-2 flex min-w-0 items-center gap-2 text-ui-base text-foreground-subtle">
        <BotIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate font-medium text-foreground">{agentName}</span>
        <span className="shrink-0 text-ui-sm">{replyLabel}</span>
      </div>
      {body}
      {onOpen ? (
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onOpen}>
          {intl.formatMessage({ id: "chat.collaboration.openConversation" })}
        </Button>
      ) : null}
    </section>
  );
}

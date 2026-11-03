import { useEffect, useState } from "react";
import { BotIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { selectAgentReplyPreview } from "@/v4/collaborationReplyPreview.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import type { SessionDataLayer, SessionLease } from "@/v4/sessionDataLayer.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

/** 从现有子会话租约显示消息；不复制运行状态，也不创建新的消息来源。 */
export function ConversationAgentReply({
  childSessionId,
  startedAt,
  agentName,
  context,
  onOpen,
}: {
  childSessionId: string;
  startedAt: number;
  agentName: string;
  context: ConversationRowRenderContext;
  onOpen?: () => void;
}) {
  const { layer } = useV4Conversation();
  const { intl } = useZCodeIntl();
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
  if (!reply) return null;

  return (
    <section
      data-testid="agent-reply-preview"
      className="mt-2 min-w-0 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <div className="mb-2 flex min-w-0 items-center gap-2 text-ui-base text-foreground-subtle">
        <BotIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate font-medium text-foreground">{agentName}</span>
        <span className="shrink-0 text-ui-sm">
          {intl.formatMessage({
            id: reply.streaming ? "chat.collaboration.replyStreaming" : "chat.collaboration.reply",
          })}
        </span>
      </div>
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
      {onOpen ? (
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onOpen}>
          {intl.formatMessage({ id: "chat.collaboration.openConversation" })}
        </Button>
      ) : null}
    </section>
  );
}

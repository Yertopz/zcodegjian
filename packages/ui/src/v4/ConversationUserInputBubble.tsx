// Modified by ZCode: 支持在同一用户消息气泡中显示正文内嵌附件，旧消息保持兼容。
import type { ReactNode } from "react";
import { ConversationUserInputBody } from "@/v4/ConversationUserInputBody.js";
import { ConversationUserInputContent } from "@/v4/ConversationUserInputContent.js";
import { ConversationUserInputEpilogue } from "@/v4/ConversationUserInputEpilogue.js";

/**
 * 正式用户消息与群话题准备态共用同一套气泡渲染（上游 3.16.2 的同一拆分）。
 *
 * 新消息可由行组件提供正文内嵌附件；没有内嵌标记的旧消息继续使用普通正文。
 */
export function ConversationUserInputBubble({
  text,
  children,
  rowId,
  attachments,
  contextAttachmentCount,
  epilogue,
}: {
  text: string;
  children?: ReactNode;
  /** 只用于展开态复位：正式行是 rowId，准备态是群消息 messageId。 */
  rowId: string | number;
  attachments?: readonly unknown[];
  contextAttachmentCount?: number;
  epilogue?: string;
}) {
  if (!text.trim() && epilogue === undefined) return null;
  return (
    <div
      data-v4-user-input-bubble="true"
      className="flex max-w-full flex-col gap-2 rounded-xl rounded-tr-xs border border-border bg-surface px-4 py-3 text-ui-base text-foreground @min-[624px]/conversation:max-w-xl"
    >
      {text.trim() ? (
        <ConversationUserInputBody contentText={text} rowId={rowId}>
          {children ?? (
            <ConversationUserInputContent
              text={text}
              attachments={attachments}
              contextAttachmentCount={contextAttachmentCount}
            />
          )}
        </ConversationUserInputBody>
      ) : null}
      {epilogue === undefined ? null : <ConversationUserInputEpilogue text={epilogue} />}
    </div>
  );
}

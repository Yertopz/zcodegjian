import { useEffect, useState } from "react";
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.js";
import { GenericFilePreview } from "./GenericFilePreview.js";
import type { ChatComposerAttachment } from "@/lib/chatAttachments.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 已发送的普通文档按消息原下标读取；请求释放时撤销，不让迟到结果串到另一份文件。 */
export function SentDocumentPreview({
  target,
  sessionId,
  rowId,
  entityId,
  readAttachment,
  onClose,
}: {
  target: { attachment: AttachmentRef; index: number } | null;
  sessionId?: string;
  rowId: number;
  entityId?: string;
  readAttachment?: ConversationRowRenderContext["readAttachment"];
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [file, setFile] = useState<ChatComposerAttachment | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFile(null);
    setFailed(false);
    if (!target) return;
    if (!sessionId || !readAttachment || !entityId) {
      setFailed(true);
      return;
    }
    const controller = new AbortController();
    let localUrl: string | undefined;
    void readAttachment({
      sessionId,
      ref: target.attachment.ref,
      purpose: "document",
      target: { rowId, entityId },
      attachmentIndex: target.index,
      signal: controller.signal,
    })
      .then(async (result) => {
        if (controller.signal.aborted) return;
        const blob =
          "url" in result
            ? await fetch(result.url, { signal: controller.signal }).then((response) => {
                if (!response.ok) throw Error("preview");
                return response.blob();
              })
            : new Blob([Uint8Array.from(result.bytes)], { type: result.mediaType });
        if (controller.signal.aborted) return;
        localUrl = URL.createObjectURL(blob);
        setFile({
          id: target.attachment.ref,
          filename: target.attachment.fileName,
          mimeType: blob.type || target.attachment.mime,
          sizeBytes: blob.size,
          objectUrl: localUrl,
          file: new File([blob], target.attachment.fileName, {
            type: blob.type || target.attachment.mime,
          }),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [target, sessionId, rowId, entityId, readAttachment]);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{target?.attachment.fileName}</DialogTitle>
          <DialogDescription>{target?.attachment.mime}</DialogDescription>
        </DialogHeader>
        {file ? (
          <GenericFilePreview attachment={file} />
        ) : (
          <p role={failed ? "alert" : "status"}>
            {intl.formatMessage({
              id: failed
                ? "chat.composer.inline.previewUnavailable"
                : "chat.attachments.preview.loading",
            })}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

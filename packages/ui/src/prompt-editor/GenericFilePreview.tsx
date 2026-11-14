import { useEffect, useState } from "react";
import type { ChatComposerAttachment } from "@/lib/chatAttachments.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getOfficeFilePreviewKind } from "@/lib/officeFilePreview.js";
import { PreviewPaneOfficeContent } from "@/previewPaneOfficeContent.js";
import type { FileBinaryPreview } from "@zcode/shared";
import { useTheme, resolveTheme } from "@/useTheme.js";
import { isTextLikeAttachment } from "@/lib/chatAttachmentMetadata.js";

/** 没有路径的浏览器文件仍可看文本；二进制不伪装为已渲染的文档。 */
export function GenericFilePreview({ attachment }: { attachment: ChatComposerAttachment | null }) {
  const { intl } = useZCodeIntl();
  const { theme } = useTheme();
  const kind = getOfficeFilePreviewKind(attachment?.filename);
  const [text, setText] = useState<string | null>(null);
  const [office, setOffice] = useState<FileBinaryPreview | null>(null);
  const [officeError, setOfficeError] = useState(false);
  useEffect(() => {
    let disposed = false;
    setText(null);
    setOffice(null);
    setOfficeError(false);
    let reader: FileReader | undefined;
    if (kind && attachment?.file && attachment.file.size <= 20 * 1024 * 1024) {
      // 复用已有 Word/Excel 只读查看器，只在打开对话框时加载；不另建文档渲染链路。
      reader = new FileReader();
      reader.onload = () => {
        if (!disposed && typeof reader?.result === "string")
          setOffice({
            path: attachment.filename,
            totalBytes: attachment.file!.size,
            dataBase64: reader.result.slice(reader.result.indexOf(",") + 1),
          });
      };
      reader.onerror = () => {
        if (!disposed) setOfficeError(true);
      };
      reader.readAsDataURL(attachment.file);
    } else if (kind) setOfficeError(true);
    if (attachment?.file && isTextLikeAttachment(attachment)) {
      void attachment.file
        .slice(0, 256 * 1024)
        .text()
        .then((value) => {
          if (!disposed) setText(value);
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      if (reader?.readyState === FileReader.LOADING) reader.abort();
    };
  }, [attachment, kind]);
  return (
    <div data-testid="composer-file-preview" className="max-h-[65vh] overflow-auto">
      {kind ? (
        <div className="h-[60vh] min-h-0">
          <PreviewPaneOfficeContent
            kind={kind}
            sourcePath={attachment?.filename ?? ""}
            preview={office}
            loading={!office && !officeError}
            error={officeError ? intl.formatMessage({ id: "codeViewer.officeUnavailable" }) : null}
            resolvedTheme={resolveTheme(theme)}
          />
        </div>
      ) : text !== null ? (
        <pre className="whitespace-pre-wrap break-words text-ui-base">{text}</pre>
      ) : (
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "chat.composer.inline.filePreview" })}
        </p>
      )}
      {attachment?.objectUrl ? (
        <a
          className="mt-3 block text-ui-base text-icon-blue"
          href={attachment.objectUrl}
          download={attachment.filename}
        >
          {intl.formatMessage({ id: "chat.composer.inline.download" })}
        </a>
      ) : null}
    </div>
  );
}

import { isAbsolute } from "node:path";

/** 输入 ref 已由 gateway 的会话/消息身份授权；这里只解析消息不可变副本，不扩展授权范围。 */
export function resolvePersistedPromptAttachment(
  input: { ref: string; mime: string },
  persisted?: { url: string; mime: string; metadata?: { artifactUri?: string } },
): { ref: string; mediaType: string; artifactUri?: string } {
  const artifactUri =
    persisted?.metadata?.artifactUri ??
    (persisted?.url.startsWith("zcode-artifact://")
      ? persisted.url
      : input.ref.startsWith("zcode-artifact://")
        ? input.ref
        : undefined);
  // 普通上传文档的 FilePart.url 可能只是文件名；覆盖 artifact 会误走 FileSystemPort，
  // 导致发送前可预览、发送后却报「必须是绝对路径」。展示名不能作为内容地址。
  const ref = artifactUri ?? (persisted && isAbsolute(persisted.url) ? persisted.url : input.ref);
  return { ref, mediaType: persisted?.mime ?? input.mime, ...(artifactUri ? { artifactUri } : {}) };
}

/** 读取通用上传附件的 data URL；媒体白名单由完成行授权的 gateway 决定。 */
export function decodePromptAttachmentDataUrl(
  content: string,
  fallbackMime: string,
  maxBytes: number,
): { bytes: Uint8Array; mediaType: string } {
  const commaIndex = content.indexOf(",");
  const headerParts =
    content.slice(0, "data:".length).toLowerCase() === "data:" && commaIndex >= 0
      ? content.slice("data:".length, commaIndex).split(";")
      : [];
  const mediaType = (headerParts.shift()?.trim() || fallbackMime).split(";", 1)[0]!.toLowerCase();
  const payload = commaIndex >= 0 ? content.slice(commaIndex + 1) : "";
  if (
    headerParts.at(-1)?.trim().toLowerCase() !== "base64" ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(payload) ||
    payload.length % 4 !== 0
  ) {
    throw new Error("fault.attachment.previewArtifactInvalid");
  }
  // 通用文档查询同样使用此解码器；在这里硬编码媒体类型会让已授权的文本/Office 上传失败。
  const bytes = Buffer.from(payload, "base64");
  if (bytes.byteLength > maxBytes) {
    throw new Error("fault.attachment.previewTooLarge");
  }
  return { bytes, mediaType };
}

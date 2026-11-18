/** 草稿只携带本地引用，提交时换成随本条消息固定的附件下标，不泄露临时 URL。 */
export const INLINE_ATTACHMENT_PATTERN = /\[([^\]\n]+)\]\(attachment:([^\s)]+)\)/g;
export function serializeInlineAttachments(text: string, ids: readonly string[]): string {
  return text.replace(INLINE_ATTACHMENT_PATTERN, (_, label: string, id: string) => {
    const index = ids.indexOf(id);
    if (index < 0) throw new Error("Missing inline attachment");
    return `[${label}](attachment-index:${index})`;
  });
}
export function splitInlineAttachments(text: string, count: number) {
  const parts: { text: string; index?: number; label?: string }[] = [];
  let offset = 0;
  for (const match of text.matchAll(/\[([^\]\n]+)\]\(attachment-index:(\d+)\)/g)) {
    const index = Number(match[2]);
    if (!Number.isSafeInteger(index) || index >= count) continue;
    parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: "", index, label: match[1] });
    offset = match.index + match[0].length;
  }
  parts.push({ text: text.slice(offset) });
  return parts;
}

/** 历史消息编辑移除文件后，引用随附件列表重排，不能误指向另一份文件。 */
export function remapInlineAttachments(text: string, retainedIndices: readonly number[]) {
  return text.replace(
    /\[([^\]\n]+)\]\(attachment-index:(\d+)\)/g,
    (_, label: string, index: string) => {
      const next = retainedIndices.indexOf(Number(index));
      return next < 0 ? "" : `[${label}](attachment-index:${next})`;
    },
  );
}

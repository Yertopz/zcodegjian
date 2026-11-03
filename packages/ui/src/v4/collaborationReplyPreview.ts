import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

/** 仅从子会话权威投影取本次运行的消息，避免恢复运行时短暂显示上一轮的回复。 */
export function selectAgentReplyPreview(
  rows: readonly ConversationRow[],
  startedAt: number | undefined,
): { text: string; streaming: boolean } | null {
  if (startedAt === undefined || !Number.isFinite(startedAt)) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (
      row?.kind === "assistantText" &&
      row.createdAt > startedAt &&
      (row.state === "complete" || row.state === "streaming") &&
      row.text.trim()
    ) {
      return { text: row.text, streaming: row.state === "streaming" };
    }
  }
  return null;
}

// 群聊视图的成员解析：把一条工具调用归到群聊成员上。
//
// SendMessage 是群聊里最常见的一条「成员发言」：它的 `to` 指向目标成员，
// 但消息的发起者是当前运行时。主会话里发起者就是主智能体（不注入成员皮，
// 保持主智能体的工具卡样式）；成员运行时镜像进父会话的行携带 authoritativeAgentType，
// 按它解析发起成员。解析不到成员（未知名字、主智能体）时返回 undefined，
// 渲染器回落普通工具卡——宁可少一张气泡，不错认一个成员。
import type { TaskChatToolCall } from "@/lib/taskChatMessageTypes.js";
import { normalizeGroupChatMemberName } from "@/lib/groupChatMembers.js";
import type { GroupChatMemberInfo } from "@/v4/conversationRowContext.js";
import { resolveToolCallIdentity } from "@/lib/toolIdentity.js";

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function readSendMessageTarget(toolCall: TaskChatToolCall): string | undefined {
  const input = toolCall.input;
  if (typeof input !== "object" || input === null) return undefined;
  const to = (input as { to?: unknown }).to;
  return typeof to === "string" && to.trim() ? to : undefined;
}

export function resolveGroupChatMemberForToolCall(
  toolCall: TaskChatToolCall,
  members: ReadonlyMap<string, GroupChatMemberInfo> | undefined,
): GroupChatMemberInfo | undefined {
  if (!members || members.size === 0) return undefined;
  const identity = resolveToolCallIdentity(toolCall);
  // 群聊气泡只换「消息类」工具的皮；文件/Shell 等工具卡保持原样。
  if (identity.family !== "message") return undefined;
  const target = readSendMessageTarget(toolCall);
  if (!target) return undefined;
  const stripped = target.replace(/^@/, "").trim().toLowerCase();
  return members.get(stripped) ?? members.get(normalize(identity.toolName));
}

/**
 * 按成员名解析展示信息（Agent 回复预览卡用）。
 * 名字归一化与名册、工具卡共用 normalizeGroupChatMemberName，避免出现
 * 「面板能匹配上、回复卡匹配不上」的大小写/空白差异。
 */
export function resolveGroupChatMemberByName(
  name: string,
  members: ReadonlyMap<string, GroupChatMemberInfo> | undefined,
): GroupChatMemberInfo | undefined {
  if (!members || members.size === 0) return undefined;
  return members.get(normalizeGroupChatMemberName(name));
}

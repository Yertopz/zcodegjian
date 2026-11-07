import {
  dedupeMentionItemsByName,
  mapAgentsToMentionItems,
  type AgentMentionInput,
  type AgentMentionMapOptions,
} from "@/mentions/providers/agentsMentionProvider.js";
import { mapTeamMembersToMentionItems } from "@/mentions/providers/teamMembersMentionProvider.js";
import type { MentionItem } from "@/mentions/mentionTypes.js";

/**
 * `/` 面板的 Agent 建议：团队成员与子智能体合并成一份扁平列表。
 *
 * `/` 只是命令入口，不像 `@` 面板那样分段展示，所以这里把两组拼起来再按名字去重；
 * 团队成员排在前面（等价于旧实现的「团队优先级 0」）。同名成员与子智能体同时存在时
 * 只保留团队成员那一条，避免用户看到两个同名候选。
 *
 * 之所以不放进任一 provider：两个 provider 互相 import `buildAgentMentionItem`
 * 会形成模块环，聚合逻辑单独放这里，依赖方向保持单向。
 */
export function mapAllAgentsToMentionItems(
  agents: readonly AgentMentionInput[],
  options: AgentMentionMapOptions = {},
): MentionItem[] {
  return dedupeMentionItemsByName([
    ...mapTeamMembersToMentionItems(agents, options),
    ...mapAgentsToMentionItems(agents, options),
  ]);
}

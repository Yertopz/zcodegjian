import { TEAM_MEMBER_MENTION_ID_PREFIX } from "@/mentions/agentMentionIds.js";
import {
  buildAgentMentionItem,
  dedupeAgentsByName,
  type AgentMentionInput,
  type AgentMentionMapOptions,
} from "@/mentions/providers/agentsMentionProvider.js";
import type { MentionItem } from "@/mentions/mentionTypes.js";

/**
 * @ 面板的「团队成员」分组。
 *
 * 与子智能体分成两个文件/两个分组的原因：团队成员是多智能体会话的主要协作对象，
 * 需要头像与颜色；子智能体是通用扩展点。二者的列表语义、排序与空态都不同，
 * 混在一个 provider 里会互相污染（例如团队态下隐藏内置 Explore 的判据）。
 *
 * 成员列表不按多智能体模式过滤：关闭多智能体后成员仍然要能被 @ 到
 * （会话可能处于团队态而全局开关已改），面板只在团队模式下多显示这段分组。
 */
export function mapTeamMembersToMentionItems(
  agents: readonly AgentMentionInput[],
  options: AgentMentionMapOptions = {},
): MentionItem[] {
  const teamAgents = agents.filter((agent) => agent.kind === "team");
  return dedupeAgentsByName(teamAgents).map((agent) =>
    buildAgentMentionItem(agent, {
      locale: options.locale,
      idPrefix: TEAM_MEMBER_MENTION_ID_PREFIX,
    }),
  );
}

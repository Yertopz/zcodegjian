/**
 * Agent 候选项的 id 前缀。
 *
 * 团队成员与子智能体在 @ 面板是两个分组，但选中后的 token 语义完全相同
 * （都是 `@名字`，category 仍是 `subagents`）。因此前缀只用于面板 id 去重与
 * `/` 面板回填时的类型判断，不参与 markdown 生成。
 */
export const SUBAGENT_MENTION_ID_PREFIX = "subagent:";
export const TEAM_MEMBER_MENTION_ID_PREFIX = "team-member:";

/** `/` 面板回填用：两种前缀都接受 Agent 语义（`@名字`），不再按来源分别判断。 */
export function isAgentMentionItemId(id: string): boolean {
  return id.startsWith(SUBAGENT_MENTION_ID_PREFIX) || id.startsWith(TEAM_MEMBER_MENTION_ID_PREFIX);
}

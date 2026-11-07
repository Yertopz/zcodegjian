// 多智能体群聊视图的会话级派生（保持引用稳定，供 rowContext memo 使用）。
//
// 数据源与所有者：
// - 已启用成员名单来自 useSubagents（已启用 agent profiles，含 CreateAgent 经 onCreated
//   追加进会话的成员——UI 端经 subagents 投影刷新可见，未运行也显示）；
// - 「多智能体模式」判定：会话主提示词 id === MULTI_AGENT_PROMPT_ID（与 CLI 工具门同一常量，
//   packages/shared/src/main-agent-prompts.ts 的默认库条目）或团队开关开启；判定集中在
//   @/lib/multiAgentMode.js，与 @ 提及分组、设置入口共用同一结论。
// 群聊样式只换渲染皮（头像/名字/简称气泡），不改变消息与工具的事实来源。
import { useMemo } from "react";
import type { AgentAvatar } from "@zcode/shared";
import { isMultiAgentModeActive } from "@/lib/multiAgentMode.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

interface GroupChatSources {
  /** 会话快照的 config（SessionPane 已按 sessionId 归一），读 mainAgentPromptId。 */
  sessionConfigMainAgentPromptId?: string | null;
  /** 团队开关（useMultiAgentConfig 的 settings.enabled）；读不到时 undefined。 */
  multiAgentEnabled?: boolean;
  /**
   * useSubagents().agents：已启用成员 profiles。
   * avatar / kind 一并透传：群聊样式要按成员身份显示头像与简介，
   * 只传颜色会让每张卡退化成首字母色块（与设置页、@ 面板的头像不一致）。
   */
  agents: readonly {
    name: string;
    description?: string;
    color?: string;
    avatar?: AgentAvatar;
    kind?: string;
  }[];
}

type GroupChatMembersMap = NonNullable<ConversationRowRenderContext["groupChatMembers"]>;
// groupChatMembers 是 ReadonlyMap<string, GroupChatMemberInfo>，直接以值类型建可写 Map。
type GroupChatMemberEntry = NonNullable<
  GroupChatMembersMap extends ReadonlyMap<string, infer V> ? V : never
>;

export function useGroupChatContext(sources: GroupChatSources): {
  groupChatActive: boolean;
  groupChatMembers: GroupChatMembersMap;
} {
  const groupChatActive = isMultiAgentModeActive({
    mainAgentPromptId: sources.sessionConfigMainAgentPromptId,
    multiAgentEnabled: sources.multiAgentEnabled,
  });

  return useMemo(() => {
    const members = new Map<string, GroupChatMemberEntry>();
    for (const agent of sources.agents) {
      const name = agent.name?.trim();
      if (!name) continue;
      members.set(name.toLowerCase(), {
        name,
        ...(agent.description?.trim() ? { description: agent.description.trim() } : {}),
        ...(agent.color ? { color: agent.color } : {}),
        ...(agent.avatar ? { avatar: agent.avatar } : {}),
        ...(agent.kind === "team" ? { kind: "team" as const } : {}),
      });
    }
    return { groupChatActive, groupChatMembers: members };
  }, [groupChatActive, sources.agents]);
}

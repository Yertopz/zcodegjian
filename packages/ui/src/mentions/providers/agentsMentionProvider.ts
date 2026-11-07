import type { AgentSummary, Locale } from "@zcode/shared";
import { resolveAgentSourceLabel } from "@/lib/agentMentionLabels.js";
import { SUBAGENT_MENTION_ID_PREFIX } from "@/mentions/agentMentionIds.js";
import { buildSubagentMentionMarkdown } from "@/mentions/mentionMarkdown.js";
import type { MentionItem } from "@/mentions/mentionTypes.js";

export type AgentMentionInput = Pick<
  AgentSummary,
  | "id"
  | "name"
  | "description"
  | "path"
  | "scope"
  | "source"
  | "enabled"
  | "modelSelection"
  | "kind"
  | "color"
  | "avatar"
>;

export interface AgentMentionMapOptions {
  locale?: Locale;
  /**
   * 多智能体模式（团队会话）为 true。团队成员列表不看这个开关 —— 他们永远单独成组；
   * 这个开关只决定「普通子智能体」要不要隐藏内置 Explore。
   */
  teamMode?: boolean;
}

const EXPLORE_AGENT_NAME = "Explore";

export function getAgentMentionPriority(agent: AgentMentionInput): number {
  // 团队成员排在最前：团队模式下它们才是 @ 的主要目标，
  // 不该被内置 Explore / general-purpose 压到列表尾部。
  if (agent.kind === "team") {
    return 0;
  }
  if (agent.scope === "workspace") {
    return 1;
  }
  if (agent.source === "user") {
    return 2;
  }
  return 3;
}

/**
 * 团队会话里内置 Explore 不算成员：runtime 的 `routeTeamMention` 用同一判据
 * （名字 + `source === "built-in"`）把它排除在团队路由外，留在 @ 面板里
 * 只会让用户点出一个 “Unknown team member”。同名但不是 built-in 的
 * （用户/项目自建 Explore）仍然是合法成员，不能一起隐藏。
 *
 * 判据必须绑定真实的多智能体模式；早先用「列表里出现过团队成员工」做推断，
 * 会在非团队会话里把内置 Explore 一起隐藏掉。
 */
export function isNonMemberBuiltInExplore(agent: AgentMentionInput): boolean {
  return agent.name === EXPLORE_AGENT_NAME && agent.source === "built-in";
}

/** 启用 + 有可用名字的 Agent；其余（禁用、空名）不进入任何候选列表。 */
function isMentionCandidate(agent: AgentMentionInput): boolean {
  return Boolean(agent.enabled) && agent.name.trim().length > 0;
}

/**
 * 同名 Agent 只保留来源优先级最高的一个（团队 > workspace > user > 其它）。
 * 保留输入顺序，排序交给 `sortAgentsByMentionPriority`，这样调用方可以自行决定
 * 「团队在前」还是「保持配置顺序」。
 */
export function dedupeAgentsByName(agents: readonly AgentMentionInput[]): AgentMentionInput[] {
  const uniqueAgentsByName = new Map<string, AgentMentionInput>();
  for (const agent of agents) {
    if (!isMentionCandidate(agent)) {
      continue;
    }
    const key = agent.name.trim().toLowerCase();
    const current = uniqueAgentsByName.get(key);
    if (!current || getAgentMentionPriority(agent) < getAgentMentionPriority(current)) {
      uniqueAgentsByName.set(key, agent);
    }
  }
  return [...uniqueAgentsByName.values()];
}

/** 稳定排序：优先级相同的保持输入顺序，避免每次渲染跳行。 */
export function sortAgentsByMentionPriority(
  agents: readonly AgentMentionInput[],
): AgentMentionInput[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort(
      (left, right) =>
        getAgentMentionPriority(left.agent) - getAgentMentionPriority(right.agent) ||
        left.index - right.index,
    )
    .map(({ agent }) => agent);
}

/**
 * 单个 Agent → 候选条目。团队成员与普通子智能体共用这份投影：token 语义相同
 * （`@名字`，category 仍是 `subagents`），差异只有面板分组 id 与携带的颜色/头像。
 */
export function buildAgentMentionItem(
  agent: AgentMentionInput,
  options: { locale?: Locale; idPrefix: string },
): MentionItem {
  const sourceLabel = resolveAgentSourceLabel(agent, options.locale);
  const model = agent.modelSelection
    ? `${agent.modelSelection.providerId}/${agent.modelSelection.modelId}`
    : undefined;
  return {
    id: `${options.idPrefix}${agent.id}`,
    category: "subagents",
    label: agent.name,
    // 模型选择属于 Agent 配置；继承父模型时保持省略，避免显示虚构的固定模型。
    description: [sourceLabel, agent.description?.trim(), model].filter(Boolean).join(" · "),
    value: agent.name,
    markdown: buildSubagentMentionMarkdown(agent.name),
    keywords: [
      agent.name,
      agent.description,
      agent.scope,
      agent.source,
      sourceLabel,
      model ?? "",
      agent.path,
    ],
    data: {
      path: agent.path,
      scope: agent.scope,
      source: agent.source,
      model,
      agentKind: agent.kind === "team" ? "team" : undefined,
      agentColor: agent.color,
      agentAvatar: agent.avatar,
    },
  };
}

/** 跨分组去重：保留先出现的一条（调用方把团队成员排在前面即等价于「团队优先」）。 */
export function dedupeMentionItemsByName(items: readonly MentionItem[]): MentionItem[] {
  const seen = new Set<string>();
  const result: MentionItem[] = [];
  for (const item of items) {
    const key = item.value.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * @ 面板的「子智能体」分组：排除团队成员。团队成员由
 * `teamMembersMentionProvider` 单独处理，两个分组各自独立排序与空态。
 */
export function mapAgentsToMentionItems(
  agents: readonly AgentMentionInput[],
  options: AgentMentionMapOptions = {},
): MentionItem[] {
  const nonTeamAgents = agents.filter((agent) => agent.kind !== "team");
  const deduped = dedupeAgentsByName(nonTeamAgents);
  const visibleAgents =
    options.teamMode === true
      ? deduped.filter((agent) => !isNonMemberBuiltInExplore(agent))
      : deduped;
  return sortAgentsByMentionPriority(visibleAgents).map((agent) =>
    buildAgentMentionItem(agent, { locale: options.locale, idPrefix: SUBAGENT_MENTION_ID_PREFIX }),
  );
}

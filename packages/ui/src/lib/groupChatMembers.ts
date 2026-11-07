// 多智能体群聊视图的成员解析与名册模型（纯函数，无 React、无 store）。
//
// 为什么需要这一层：成员身份（头像 / 名字 / 简介 / 颜色）分散在三处渲染
// （SendMessage 群聊气泡、Agent 回复预览卡、Agent 工具卡的团队成员态），
// 左侧成员面板是第四处。四处各自按名字查 store 会得到不同的匹配规则
// （大小写、id 与 name 混用、trim），最终表现为「同一个成员在两处头像不同」。
// 匹配规则与名册顺序都集中在这里，渲染层只消费结果。
//
// 数据所有者不变：成员配置仍是 useSubagentsStore.agents（AgentSummary），
// 运行状态仍是 useSessionSubagents 的 running 列表；本模块不缓存、不写入。
import type { AgentAvatar, AgentColor } from "@zcode/shared";

/** 名册条目的运行状态；未匹配到运行中子会话时为 idle（成员已配置但没在跑）。 */
export type GroupChatMemberStatus = "running" | "waiting" | "blocked" | "idle";

/** 名册的成员配置来源：AgentSummary 里身份展示与筛选所需的字段。 */
export interface GroupChatRosterAgentSource {
  id: string;
  name: string;
  description?: string;
  avatar?: AgentAvatar;
  color?: AgentColor;
  /** 团队成员为 "team"；内置子智能体无此值。 */
  kind?: string;
  enabled?: boolean;
}

/** 名册的运行态来源：useSessionSubagents().running 的元素形状（可含额外字段）。 */
export interface GroupChatRosterRunningSource {
  childSessionId: string;
  /** 子会话的类型名，等于成员名。 */
  subagentType: string;
  startedAt?: number;
  status: "running" | "waiting" | "blocked";
}

/** 成员面板的一行。 */
export interface GroupChatRosterEntry {
  id: string;
  name: string;
  description?: string;
  avatar?: AgentAvatar;
  color?: AgentColor;
  status: GroupChatMemberStatus;
  /** 仅在匹配到运行中子会话时存在；没有它时该行不可点击。 */
  childSessionId?: string;
  startedAt?: number;
}

/** 名字/ID 归一化：去空白 + 大小写不敏感。agent 名允许 `[a-zA-Z0-9-]`，大小写仍是不同名字。 */
export function normalizeGroupChatMemberName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 按名字（优先）或 id 解析成员配置。
 * 先比 name 是因为 @ 提及与工具卡上的成员身份都是名字；id 兜底只在
 * 调用方拿到的是 CreateAgent 的返回值（agent id）时才命中。
 */
export function resolveGroupChatMember<T extends GroupChatRosterAgentSource>(
  agents: readonly T[],
  nameOrId: string,
): T | undefined {
  const lookup = normalizeGroupChatMemberName(nameOrId);
  if (!lookup) {
    return undefined;
  }
  return (
    agents.find((agent) => normalizeGroupChatMemberName(agent.name) === lookup) ??
    agents.find((agent) => normalizeGroupChatMemberName(agent.id) === lookup)
  );
}

/** 同一成员类型可能有多条运行会话（连续派单）；取 startedAt 最新的一条。 */
function pickLatestRunning(
  candidates: readonly GroupChatRosterRunningSource[],
): GroupChatRosterRunningSource | undefined {
  let latest: GroupChatRosterRunningSource | undefined;
  for (const candidate of candidates) {
    if (!latest) {
      latest = candidate;
      continue;
    }
    if ((candidate.startedAt ?? 0) >= (latest.startedAt ?? 0)) {
      latest = candidate;
    }
  }
  return latest;
}

/**
 * 构建成员面板名册。
 *
 * 筛选规则（产品边界）：
 * - 只列团队成员（kind === "team"）：内置子智能体在会话状态面板的 agents 分区已有位置，
 *   混进成员面板会让「团队」与「临时子智能体」变成同一个概念；
 * - 只列已启用的成员：设置里关掉的成员点了也起不来；
 * - 顺序沿用 agents 的存储顺序，不做运行态优先排序——面板位置随运行状态跳动
 *   会让「点第三个头像是谁」失去肌肉记忆。
 */
export function buildGroupChatMemberRoster({
  agents,
  running,
}: {
  agents: readonly GroupChatRosterAgentSource[];
  running: readonly GroupChatRosterRunningSource[];
}): GroupChatRosterEntry[] {
  const runningByMember = new Map<string, GroupChatRosterRunningSource[]>();
  for (const candidate of running) {
    const key = normalizeGroupChatMemberName(candidate.subagentType);
    if (!key) continue;
    const bucket = runningByMember.get(key);
    if (bucket) {
      bucket.push(candidate);
    } else {
      runningByMember.set(key, [candidate]);
    }
  }

  const entries: GroupChatRosterEntry[] = [];
  for (const agent of agents) {
    if (agent.kind !== "team") continue;
    if (agent.enabled === false) continue;
    const name = agent.name?.trim();
    if (!name) continue;
    const active = pickLatestRunning(runningByMember.get(normalizeGroupChatMemberName(name)) ?? []);
    entries.push({
      id: agent.id,
      name,
      ...(agent.description?.trim() ? { description: agent.description.trim() } : {}),
      ...(agent.avatar ? { avatar: agent.avatar } : {}),
      ...(agent.color ? { color: agent.color } : {}),
      status: active?.status ?? "idle",
      ...(active ? { childSessionId: active.childSessionId } : {}),
      ...(active?.startedAt !== undefined ? { startedAt: active.startedAt } : {}),
    });
  }
  return entries;
}

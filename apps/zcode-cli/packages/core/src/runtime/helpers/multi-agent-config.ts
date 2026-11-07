import {
  MAIN_AGENT_CREATOR_ID,
  MULTI_AGENT_PROMPT_ID as sharedMultiAgentPromptId,
} from "@zcode/shared";
import type { MultiAgentRuntimeSettings } from "@zcode/shared";
import { DEFAULT_PEER_MESSAGE_BUDGET } from "../../subagent/peer-message.js";
import type { CreateAgentTarget } from "../../tool/index.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { AgentRuntimeConfig, AgentRuntimeMultiAgentSettings } from "../types.js";

/**
 * 「多智能体」（agent team）在运行期的唯一推导点。
 *
 * 为什么集中在这里：`includeAgent` 有两个注册入口（初次装配 `runtime-tools.ts` 与
 * shell 快照刷新 `embedded-search-branch.ts`），两处必须给出同一结论；
 * 第二条入口曾因为少传一个选项而静默把工具加了回来（见 embedded-search-branch 的注释）。
 *
 * 产品规则：
 * ① 多智能体模式开启时，成员之间用 `SendMessage`（互相 @）协作，不再派生子智能体 ——
 *    「团队」和「层层分包」是两种协作模型，混在一起会让 @ 次数预算失去意义；
 * ② 子运行时（`taskType: "subagent_child"`）永远不再开启团队模式，只可能被指定为
 *    「创建者」以使用 `CreateAgent`；
 * ③ 设置由 bootstrap 每建会话从 `agents-state.json` 读一次，协议侧传入的同名字段一律覆盖，
 *    避免 Renderer 自行打开一个进程级开关。
 */

/** 主会话在「多智能体」里的身份名，直接复用设置文件默认的 `creatorAgentId`。 */
export const MAIN_RUNTIME_AGENT_NAME = MAIN_AGENT_CREATOR_ID;

export function createRuntimeMultiAgentSettings(
  settings: MultiAgentRuntimeSettings,
  agentName: string,
): AgentRuntimeMultiAgentSettings {
  return {
    enabled: settings.enabled,
    mentionLimit: settings.mentionLimit,
    creatorAgentId: settings.creatorAgentId,
    // 只有被指定的创建者能建新成员；默认 `main` 即主智能体。
    canCreateAgents: settings.enabled && settings.creatorAgentId === agentName,
  };
}

/** 主运行时的团队设置。 */
export function createMainRuntimeMultiAgentSettings(
  settings: MultiAgentRuntimeSettings,
): AgentRuntimeMultiAgentSettings {
  return createRuntimeMultiAgentSettings(settings, MAIN_RUNTIME_AGENT_NAME);
}

/**
 * 子运行时看到的团队设置：团队模式对子运行时不生效（不能再派生），但「创建者」身份保留，
 * 让多智能体中某个成员可以调用 `CreateAgent` 拉新人进团队。
 */
export function createChildMultiAgentSettings(
  parent: AgentRuntimeMultiAgentSettings | undefined,
  childAgentName: string,
): AgentRuntimeMultiAgentSettings | undefined {
  if (!parent) return undefined;
  return {
    enabled: false,
    mentionLimit: parent.mentionLimit,
    creatorAgentId: parent.creatorAgentId,
    canCreateAgents: parent.enabled && parent.creatorAgentId === childAgentName,
  };
}

export function resolveMultiAgentEnabled(config: Pick<AgentRuntimeConfig, "multiAgent">): boolean {
  return config.multiAgent?.enabled === true;
}

/**
 * 主提示词「多智能体模式」（`packages/shared/src/main-agent-prompts.ts` 默认库）的门。
 *
 * 与设置页团队开关同等生效：选中该提示词的会话在工具注册层拿不到 Agent / Task，
 * 不是提示词约束。提示词正文只承担协作分工指导，权限边界全部落在工具门上——
 * 模型无法靠改写提示词绕过，两个注册入口共用 `resolveIncludeAgentTool`，结论必然一致。
 * id 常量由 `@zcode/shared` 的 `MULTI_AGENT_PROMPT_ID` 所有，UI 群聊视图共用同一份。
 */
export const MULTI_AGENT_PROMPT_ID = sharedMultiAgentPromptId;

export function resolveMultiAgentPromptActive(
  config: Pick<AgentRuntimeConfig, "mainAgentPrompt" | "mainAgentPromptId">,
): boolean {
  // 主提示词的选择发生在运行时构造之后：`AgentRuntime` 构造时 initializeRuntimeTooling
  // 就把工具表装配完了，而 `mainAgentPrompt`（本轮固定快照）只在一个 turn 内由 envelope 落值，
  // 新建会话的 `mainAgentPromptId` 也是构造完才由 setMainAgentPrompt 写入。
  // 只读快照 ⇒ 构造那一刻永远是 undefined ⇒ 门恒为 false ⇒ Agent/Task 先注册上，
  // 之后选中「多智能体模式」也摘不掉，用户看到的仍是子智能体分包。
  // 所以以持久选择 `mainAgentPromptId` 为准（含显式 null = 无主提示词），
  // 仅当它未设置（undefined，TUI/headless 不写该字段）时才回落到本轮快照。
  const selectedId =
    config.mainAgentPromptId !== undefined
      ? config.mainAgentPromptId
      : (config.mainAgentPrompt?.id ?? null);
  return selectedId === MULTI_AGENT_PROMPT_ID;
}

/**
 * `SendMessage` 的 @ 次数上限：团队模式取设置页的 `mentionLimit`（默认 8），
 * 非团队会话保持历史的 32 次——开团队不该让普通会话的同伴预算悄悄变小。
 */
export function resolvePeerMessageBudgetLimit(
  config: Pick<AgentRuntimeConfig, "multiAgent">,
): number {
  if (config.multiAgent?.enabled !== true) return DEFAULT_PEER_MESSAGE_BUDGET;
  return config.multiAgent.mentionLimit;
}

export function resolveIncludeAgentTool(params: {
  config: Pick<
    AgentRuntimeConfig,
    "subagents" | "multiAgent" | "mainAgentPrompt" | "mainAgentPromptId"
  >;
  hasSubagentPort: boolean;
}): boolean {
  if (!params.hasSubagentPort) return false;
  if (params.config.subagents?.enabled === false) return false;
  // 团队模式下用 @ 协作，不分包：Agent（派生）工具整体下架。
  // 主提示词「多智能体模式」激活时同等生效——两个门共用这条推导，任一命中即下架。
  return !(resolveMultiAgentEnabled(params.config) || resolveMultiAgentPromptActive(params.config));
}

export function resolveIncludeCreateAgentTool(
  config: Pick<AgentRuntimeConfig, "subagents" | "multiAgent">,
): boolean {
  // 「创建者」身份来自设置（默认主智能体）；没有用户级 agent 目录就没有可写位置，
  // 此时宁可不下架也不注册一个注定失败的写盘工具。
  if (config.multiAgent?.canCreateAgents !== true) return false;
  return (config.subagents?.userAgentsDir?.trim().length ?? 0) > 0;
}

/**
 * `CreateAgent` 的装配参数：写盘目录来自 bootstrap（`<storageRoot>/agents`），
 * 登记回调直接改 runtime 的 profile 列表——那是本会话 `@` 路由与 `Agent` 描述的唯一数据源，
 * 新建成员因此不必重开会话就能被 `@`。
 *
 * 与 `resolveIncludeAgentTool` 放在一起的原因同上：这条推导有两个注册入口，
 * 必须共用一份结论。非创建者（团队成员、普通子运行时）拿到 `undefined`。
 */
export function resolveRuntimeCreateAgentTarget(
  runtime: Pick<AgentRuntimeInternal, "config" | "logger">,
): CreateAgentTarget | undefined {
  const agentsDir = runtime.config.subagents?.userAgentsDir?.trim();
  if (!agentsDir) return undefined;
  if (!resolveIncludeCreateAgentTool(runtime.config)) return undefined;
  return {
    agentsDir,
    enabledAgentNames: () => (runtime.config.subagents?.profiles ?? []).map((item) => item.name),
    onCreated: (profile) => {
      const subagents = runtime.config.subagents;
      if (!subagents) return;
      // 团队路由与 Agent 描述每次都现读这份列表，追加即可生效；不重建 runtime，
      // 会话历史、已用 @ 次数和进行中的任务都不受影响。
      subagents.profiles = [...(subagents.profiles ?? []), profile];
      runtime.logger?.info?.("Created agent profile", {
        event: "runtime.agent.created",
        module: "core.runtime",
        agentName: profile.name,
        agentCount: subagents.profiles.length,
      });
    },
  };
}

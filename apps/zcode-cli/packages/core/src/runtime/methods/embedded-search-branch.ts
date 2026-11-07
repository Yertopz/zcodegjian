import type { ModelToolContract } from "../deps.js";
import { registerBuiltInTools } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { resolveEmbeddedSearchBranchCapability } from "../../embedded-search/capability.js";
import {
  resolveBuiltInToolAllowlist,
  resolveRuntimeDynamicWorkflowToolsIncluded,
} from "../helpers/tool-allowlist.js";
import {
  resolveIncludeAgentTool,
  resolveIncludeCreateAgentTool,
  resolveRuntimeCreateAgentTarget,
} from "../helpers/multi-agent-config.js";
import { isToolNameDisallowed } from "../../tool/tool-visibility.js";
import { isSubagentDispatchToolName } from "../../tool/compat.js";

export function resolveRuntimeEmbeddedSearchEnabled(runtime: AgentRuntimeInternal): boolean {
  const builtInToolAllowlist = resolveBuiltInToolAllowlist(runtime.config);
  const decision = resolveEmbeddedSearchBranchCapability({
    bashAvailable:
      (builtInToolAllowlist === undefined || builtInToolAllowlist.includes("Bash")) &&
      !isToolNameDisallowed("Bash", runtime.config.toolDisallowlist),
  });
  return decision.useEmbeddedSearchBranch;
}

export function refreshBranchAwareBuiltInTools(runtime: AgentRuntimeInternal): void {
  const embeddedSearchEnabled = resolveRuntimeEmbeddedSearchEnabled(runtime);
  if (embeddedSearchEnabled) {
    runtime.registry.unregister("Glob");
    runtime.registry.unregister("Grep");
  }
  const createAgentTarget = resolveRuntimeCreateAgentTarget(runtime);

  registerBuiltInTools(runtime.registry, {
    bashTimeoutPolicy: runtime.config.bashTimeoutPolicy,
    includeSkill: Boolean(runtime.skillPort),
    // 与初次装配同款：模式门双向生效。本函数是「选中/恢复主提示词后」重建工具表的唯一入口，
    // 门为假时必须能摘掉上次装上的 Agent/Task/SendMessage/CreateAgent。
    unregister: (name) => runtime.registry.unregister(name),
    // 搜索分支刷新也必须保持子运行时的派生禁令；多智能体模式下的团队禁令同理，
    // 推导与初次装配共用 runtime/helpers/multi-agent-config.ts，不在这里重写判断。
    includeAgent: resolveIncludeAgentTool({
      config: runtime.config,
      hasSubagentPort: Boolean(runtime.subagentPort),
    }),
    // CreateAgent 与 Agent 相反：只有创建者才装配，必须显式带上同一份推导与写盘目标，
    // 否则 shell 快照刷新后「创建者」的建人能力会静默消失。
    includeCreateAgent: resolveIncludeCreateAgentTool(runtime.config),
    ...(createAgentTarget ? { createAgentTarget } : {}),
    embeddedSearchEnabled,
    // 本函数是**第二个**
    // 注册入口，且刻意只传一个精简选项集。对「只有 true 才注册」的门（OffPeak / Cron / Workflow…）
    // 省略是安全的；但动态工作流灰度门的极性相反——「缺席即开启」，省略等于把首次装配剃掉的
    // 十个工具在 shell 快照初始化时原样加回来（registry.register 会覆盖同名项，
    // silentDuplicateWarnings 还把告警吞掉，所以全程无声）。推导因此必须与 runtime-tools.ts
    // 共用同一个 helper，不能在这里重写一遍判断。
    includeDynamicWorkflow: resolveRuntimeDynamicWorkflowToolsIncluded(runtime.config),
    agentProfiles: runtime.config.subagents?.profiles,
    allowedTools: resolveBuiltInToolAllowlist(runtime.config),
    disallowedTools: runtime.config.toolDisallowlist,
    silentDuplicateWarnings: true,
  });
  runtime.cachedTools = null;
  // 模式门是「选中即生效」，但工具装配发生在构造之后，出问题时唯一可见的表象是
  // 「选了多智能体模式却仍在派生子智能体」。门的输入与刷新后的派生工具必须留在日志里，
  // 下一次同类问题才能从日志直接定性，而不是再跑一遍浏览器取证。
  runtime.logger?.info("Branch-aware built-in tools refreshed", {
    event: "runtime.builtin_tools.refreshed",
    dispatchTools: runtime.registry.list().filter((name) => isSubagentDispatchToolName(name)),
    includeAgent: resolveIncludeAgentTool({
      config: runtime.config,
      hasSubagentPort: Boolean(runtime.subagentPort),
    }),
    mainAgentPromptId: runtime.config.mainAgentPromptId ?? null,
  });
}

export function filterEmbeddedSearchRuntimeVisibleTools(
  runtime: AgentRuntimeInternal,
  tools: ModelToolContract[],
): ModelToolContract[] {
  if (!resolveRuntimeEmbeddedSearchEnabled(runtime)) return tools;
  return tools.filter((tool) => tool.name !== "Glob" && tool.name !== "Grep");
}

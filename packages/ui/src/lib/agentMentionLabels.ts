import type { Locale } from "@zcode/shared";

/**
 * Agent 候选项的来源标签（@ 面板与 `/` 建议第二行）。
 *
 * 只有团队成员需要本地化：它是产品文案，中文写死在 provider 里会让 en-US 用户看到
 * 「多智能体」。其余取值（Workspace / Plugin / Built-in / User）是配置来源名，
 * 两种语言写法相同，不进 i18n 词汇表，避免多一层语义抖动。
 */
export interface AgentSourceFields {
  kind?: "team";
  scope?: "built-in" | "workspace" | "user";
  source?: "built-in" | "user" | "plugin";
}

export type AgentSourceKind = "team" | "workspace" | "plugin" | "built-in" | "user";

const TEAM_SOURCE_LABELS: Record<Locale, string> = {
  "zh-CN": "多智能体",
  "en-US": "Multi-agent",
};

/** 来源判定顺序即优先级语义：team > workspace > plugin > built-in > user。 */
export function resolveAgentSourceKind(agent: AgentSourceFields): AgentSourceKind {
  if (agent.kind === "team") {
    return "team";
  }
  if (agent.scope === "workspace") {
    return "workspace";
  }
  if (agent.source === "plugin") {
    return "plugin";
  }
  if (agent.source === "built-in") {
    return "built-in";
  }
  return "user";
}

export function resolveAgentSourceLabel(agent: AgentSourceFields, locale?: Locale): string {
  switch (resolveAgentSourceKind(agent)) {
    case "team":
      return TEAM_SOURCE_LABELS[locale ?? "zh-CN"] ?? TEAM_SOURCE_LABELS["zh-CN"];
    case "workspace":
      return "Workspace";
    case "plugin":
      return "Plugin";
    case "built-in":
      return "Built-in";
    default:
      return "User";
  }
}

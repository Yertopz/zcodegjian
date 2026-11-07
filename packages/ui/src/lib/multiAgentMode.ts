import { MULTI_AGENT_PROMPT_ID } from "@zcode/shared";

/**
 * 「当前提示词是否处于多智能体模式」的唯一判定。
 *
 * 两个来源是并列的（任一成立即成立），不要把它们改写成依赖顺序：
 * ① 主提示词本身是多智能体提示词（`MULTI_AGENT_PROMPT_ID`，与 CLI 工具门同一常量）；
 * ② 设置里的团队开关开启 —— 开关开启时即使选了别的提示词也算团队模式。
 *
 * 判定集中在这里而不是各调用点内联，是因为 @ 提及分组、群聊渲染皮、设置入口都要用同一个结论；
 * 三处各写一遍 `=== MULTI_AGENT_PROMPT_ID || enabled === true` 迟早漂移。
 */
export function isMultiAgentModeActive(sources: {
  mainAgentPromptId?: string | null;
  multiAgentEnabled?: boolean;
}): boolean {
  return sources.mainAgentPromptId === MULTI_AGENT_PROMPT_ID || sources.multiAgentEnabled === true;
}

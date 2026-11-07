import type { SessionEvent, SessionId, TraceContext } from "../deps.js";
import { createSessionEvent, SessionEventType } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { refreshBranchAwareBuiltInTools } from "./embedded-search-branch.js";

export const MAIN_AGENT_PROMPT_ENTRY_TYPE = "main_agent_prompt";

export function buildMainAgentPromptEntry(sessionID: SessionId, id: string | null) {
  const now = Date.now();
  return {
    id: `main-agent-prompt:${sessionID}`,
    sessionID,
    type: MAIN_AGENT_PROMPT_ENTRY_TYPE,
    time: { created: now, updated: now },
    data: { id },
  };
}

export function getMainAgentPromptId(this: AgentRuntimeInternal): string | null {
  return this.config.mainAgentPromptId ?? null;
}

export async function setMainAgentPrompt(
  this: AgentRuntimeInternal,
  options: { id: string | null; traceContext?: TraceContext },
): Promise<void> {
  const traceContext = options.traceContext ?? this.rootTraceContext;
  // 草稿尚无 session 外键，首次持久化时统一保存；已有会话保存失败不得发布新选择。
  if (this.sessionPersisted) {
    await this.sessionStore?.saveSessionEntry?.(
      buildMainAgentPromptEntry(this.sessionId, options.id),
    );
  }
  const event = createSessionEvent(
    SessionEventType.MainAgentPromptSelected,
    this.sessionId,
    { id: options.id },
    { traceId: traceContext.traceId },
  );
  await this.appendEvent(event, traceContext);
  this.config.mainAgentPromptId = options.id;
  // 工具表在 `AgentRuntime` 构造时就装配完了，而选择发生在构造之后（新建会话也是先
  // createSessionRecord 再 setMainAgentPrompt）。模式门读的是这份选择，所以必须在这里
  // 立刻重跑装配：选中「多智能体模式」要能当场摘掉 Agent/Task，切走要能把它们加回来。
  // 少了这一步，状态改了而工具面没变，模型仍按子智能体分包——正是「选多智能体却仍是子智能体」的成因。
  refreshBranchAwareBuiltInTools(this);
}

export async function restoreMainAgentPromptSelection(
  runtime: AgentRuntimeInternal,
  events: SessionEvent[],
): Promise<void> {
  const entries = await runtime.sessionStore?.sessionEntries?.({
    sessionID: runtime.sessionId,
    type: MAIN_AGENT_PROMPT_ENTRY_TYPE,
  });
  // null 是显式默认，不能用 ?? 借回旧事件里的角色；旧会话没有记录时才按默认解释。
  const id = entries?.length
    ? (entries.at(-1)?.data as { id?: unknown } | undefined)?.id
    : (
        events.filter((event) => event.type === SessionEventType.MainAgentPromptSelected).at(-1)
          ?.payload as { id?: unknown } | undefined
      )?.id;
  runtime.config.mainAgentPromptId = typeof id === "string" && id.trim() ? id : null;
  // 恢复（resume）同样晚于构造：不在这里重跑装配，恢复出来的会话会继续带着构造时
  // 按「未选择」装好的 Agent/Task，多智能体模式等于没恢复。
  refreshBranchAwareBuiltInTools(runtime);
}

import type { SessionEvent, SessionId, TraceContext } from "../deps.js";
import { createSessionEvent, SessionEventType } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";

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
}

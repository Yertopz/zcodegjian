import {
  CoreErrorType,
  SEND_MESSAGE_TOOL_NAME,
  SendMessageInputJsonSchema,
  SendMessageInputSchema,
  SendMessageOutputSchema,
  createCoreError,
  type SendMessageInput,
  type SendMessageOutput,
  type SubagentSendMessageResult,
  type TraceContext,
} from "@zcode/contracts";
import type { ToolEntry, ToolHandler } from "../types.js";
import { assertNotOffPeakTurn } from "./off-peak.js";

const MAX_SEND_MESSAGE_MODEL_BYTES = 4096;
/**
 * SendMessage 续跑已完成子 Agent 走
 * resumeTerminalAgentInBackground，不携带闲时轮的 subagentModelOverride，子 Agent 按父会话
 * 常驻选择重建模型，请求全部计入用户 Coding Plan。闲时轮内子 Agent 均为前台同步完成，
 * SendMessage 唯一有意义的用途就是这条泄漏路径，因此直接拒绝。
 */
const OFF_PEAK_SEND_MESSAGE_HINT =
  "Spawn a new foreground Agent with the full context instead of resuming a completed one.";

const SEND_MESSAGE_PROVIDER_DESCRIPTION = [
  "# SendMessage",
  "",
  "Send a message to another agent.",
  "",
  "```json",
  '{"to": "agent_<uuid>", "summary": "assign task 1", "message": "start on task #1"}',
  "```",
  "",
  "Your plain text output is NOT visible to other agents — to communicate, you MUST call this tool. Messages from agents are delivered automatically; you don't check an inbox. Refer to local agents by the `agentId` returned in the Agent spawn result. To resume a completed agent, use its `agentId`; it resumes in the background and you'll be notified when it finishes.",
].join("\n");

const PEER_SEND_MESSAGE_PROVIDER_DESCRIPTION = [
  "# SendMessage",
  "Send a message to a running peer in the same parent conversation. Use the peer's agent ID or its unique agent type name (optionally prefixed with @).",
  "The peer must already be running and ready; this tool cannot start or resume agents. Names shared by multiple running peers require an agent ID. Sending to yourself or another session is rejected.",
  "Peer messages have a shared limit and remain subject to each agent's permission rules. You may receive replies automatically during your current turn.",
].join("\n\n");

const SEND_MESSAGE_TOOL_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    success: { type: "boolean" },
    message: { type: "string" },
  },
  required: ["success", "message"],
  additionalProperties: false,
};

const sendMessageHandler: ToolHandler = async (input, context) => {
  const parsed = SendMessageInputSchema.parse(input) as SendMessageInput;
  assertNotOffPeakTurn(context, SEND_MESSAGE_TOOL_NAME, {
    hint: OFF_PEAK_SEND_MESSAGE_HINT,
    recoverable: true,
  });

  if (!context.subagentPort?.sendMessage) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "Subagent port is not configured for SendMessage",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: SEND_MESSAGE_TOOL_NAME,
        },
        recoverable: false,
      },
    );
  }

  const result = await context.subagentPort.sendMessage(
    {
      sessionId: context.sessionId,
      turnId: context.turnId,
      parentToolCallId: context.toolCallId,
      to: parsed.to,
      summary: parsed.summary,
      message: parsed.message,
      workingDirectory: context.workingDirectory,
      workspaceRoot: context.workspaceRoot,
      trace: resolveToolTraceContext(context),
    },
    { signal: context.abortSignal },
  );
  return toSendMessageOutput(result);
};

/**
 * 把「剩余 @ 次数」从端口结果抬到工具输出：`mentionBudget` 是内部口径，
 * 模型看到的是 `mentionsRemaining` / `mentionLimit`，并附一句可直接读的提示，
 * 否则模型只能靠猜还剩几次（这也是团队模式最容易打空额度的原因）。
 */
function toSendMessageOutput(result: SubagentSendMessageResult): SendMessageOutput {
  const budget = result.mentionBudget;
  const { mentionBudget: _ignored, ...rest } = result;
  if (!budget) return rest satisfies SendMessageOutput;
  const budgetNote = `Peer mentions remaining: ${budget.remaining} of ${budget.limit}.`;
  return {
    ...rest,
    mentionsRemaining: budget.remaining,
    mentionLimit: budget.limit,
    message: rest.message ? `${rest.message} ${budgetNote}` : budgetNote,
  } satisfies SendMessageOutput;
}

export const sendMessageToolEntry: ToolEntry = {
  capability: "Send a short message to a local agent",
  metadata: {
    // Bug 根因：SendMessage 曾声明 shouldDefer，团队会话里模型只看到目录名而拿不到 schema，
    // 于是反复输出「我现在向 X 发送…」这类计划文字却不真正调用，成员从未启动。
    // 分派成员是多智能体的核心动作，与「偶尔用一次的冷工具」不同，必须让它常驻可见。
    alwaysLoad: true,
    searchHint: "send messages to agent teammates",
    name: SEND_MESSAGE_TOOL_NAME,
    description: SEND_MESSAGE_PROVIDER_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: 10000,
    maxOutputBytes: MAX_SEND_MESSAGE_MODEL_BYTES,
    sideEffectScope: "session",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: sendMessageHandler,
  formatModelContent: formatSendMessageModelContent,
  inputSchema: SendMessageInputJsonSchema,
  outputSchema: SEND_MESSAGE_TOOL_OUTPUT_SCHEMA,
  runtimeInputSchema: SendMessageInputSchema,
  runtimeOutputSchema: SendMessageOutputSchema,
  permission: {
    permission: "agent.message.send",
    reason: "SendMessage writes a message to a local agent queue",
    riskLevel: "low",
    sideEffectScope: "session",
    needsApproval: false,
    patternSources: ["toolName", "input"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: MAX_SEND_MESSAGE_MODEL_BYTES,
    maxModelBytes: MAX_SEND_MESSAGE_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: MAX_SEND_MESSAGE_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: 10000,
    maxMs: 10000,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "SendMessage was cancelled before delivery status returned",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

export function createSendMessageToolEntry(options: { peerOnly?: boolean } = {}): ToolEntry {
  if (!options.peerOnly) return sendMessageToolEntry;
  return {
    ...sendMessageToolEntry,
    metadata: { ...sendMessageToolEntry.metadata, description: PEER_SEND_MESSAGE_PROVIDER_DESCRIPTION },
  };
}

function formatSendMessageModelContent(output: unknown): string {
  const result = SendMessageOutputSchema.parse(output);
  if (result.message) return result.message;
  if (result.status === "success") {
    if (result.delivery) {
      return `Message ${result.messageId} was ${result.delivery} for local agent ${result.agentId ?? result.taskId ?? "unknown"}.`;
    }
    return `Message ${result.messageId} was queued for local agent ${result.agentId ?? result.taskId ?? "unknown"}.`;
  }
  return `Message ${result.messageId} failed to send to local agent ${result.agentId ?? result.taskId ?? "unknown"}: ${result.error ?? "unknown error"}.`;
}

function resolveToolTraceContext(context: Parameters<ToolHandler>[1]): TraceContext {
  return (
    context.traceContext ?? {
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      sessionId: context.sessionId,
      turnId: context.turnId,
    }
  );
}

import type { TraceContext, TurnSteerInput, TurnSteerResult } from "@zcode/contracts";
import type { RuntimeTaskMessageSink, RuntimeTaskPendingMessage } from "../runtime-task/registry.js";

interface SteerableRuntime {
  steerTurn(input: string | TurnSteerInput): Promise<TurnSteerResult>;
}

export function createSubagentMessageSink(
  runtime: SteerableRuntime,
  request: { traceContext: TraceContext },
): RuntimeTaskMessageSink {
  return {
    async send(message) {
      const result = await steerSubagentMessage(runtime, request, message);
      if (result.kind === "rejected") {
        throw new Error(`Subagent message rejected: ${result.reason}`);
      }
      return "steered";
    },
  };
}

async function steerSubagentMessage(
  runtime: SteerableRuntime,
  request: { traceContext: TraceContext },
  message: RuntimeTaskPendingMessage,
): Promise<TurnSteerResult> {
  const input = formatSubagentCoordinatorMessage(message);
  // 同伴不能冒充协调者或用户授权，复用既有同伴消息的权限提示。
  const inputPresentation = message.origin?.kind === "peer" ? "subagent_reply_steer" : "coordinator_steer";
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await runtime.steerTurn({
      delivery: "guide",
      inputPresentation,
      input,
      inputId: message.id,
      traceContext: message.traceContext ?? request.traceContext,
    });
    if (result.kind !== "rejected" || result.reason !== "no_active_turn") {
      return result;
    }
    await sleep(10);
  }
  return runtime.steerTurn({
    delivery: "guide",
    inputPresentation,
    input,
    inputId: message.id,
    traceContext: message.traceContext ?? request.traceContext,
  });
}

function formatSubagentCoordinatorMessage(message: RuntimeTaskPendingMessage): string {
  const summary = message.summary?.trim();
  const origin = message.origin;
  const sender = origin?.kind === "peer"
    ? `agent-id: ${origin.agentId}\nagent-type: ${origin.agentType}`
    : undefined;
  // 团队模式的「互相 @」必须让接收方看见额度：它决定这一轮还能不能继续 @ 别人，
  // 也避免两个成员互相回复到额度耗尽才发现。只在确有快照时注入。
  const budget = origin?.kind === "peer" && origin.mentionBudget
    ? `本会话剩余 @ 次数：${origin.mentionBudget.remaining}（上限 ${origin.mentionBudget.limit}）`
    : undefined;
  return [sender, budget, summary, message.message].filter(Boolean).join("\n\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

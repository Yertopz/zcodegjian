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
  const sender = message.origin?.kind === "peer"
    ? `agent-id: ${message.origin.agentId}\nagent-type: ${message.origin.agentType}`
    : undefined;
  return [sender, summary, message.message].filter(Boolean).join("\n\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

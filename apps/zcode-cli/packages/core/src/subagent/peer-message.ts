import { createHash, randomUUID } from "node:crypto";
import type { SessionId, SubagentPort, SubagentSendMessageRequest, SubagentSendMessageResult } from "@zcode/contracts";
import { isTerminalRuntimeTask, type RuntimeTaskRegistry, type RuntimeTaskSnapshot } from "../runtime-task/registry.js";

/** 一份额度属于父运行时，所有子智能体共用；失败的投递也消耗额度以限制重试循环。 */
export function createPeerMessageBudget(limit = 32) {
  let attempts = 0;
  const calls = new Map<string, { digest: string; result: Promise<SubagentSendMessageResult> }>();
  return {
    lookup(key: string, digest: string) {
      const existing = calls.get(key);
      if (!existing) return { kind: "new" as const };
      if (existing.digest !== digest) return { kind: "conflict" as const };
      return { kind: "existing" as const, result: existing.result };
    },
    start(key: string, digest: string, run: () => Promise<SubagentSendMessageResult>) {
      if (attempts >= limit) return undefined;
      attempts += 1;
      let finish!: (result: SubagentSendMessageResult) => void;
      const result = new Promise<SubagentSendMessageResult>((resolve) => { finish = resolve; });
      // 先登记 promise 再调用接收端，保证并发重试共享同一次准入。
      calls.set(key, { digest, result });
      void run().then(finish);
      return result;
    },
  };
}

export function createPeerSubagentPort(options: {
  registry: RuntimeTaskRegistry;
  parentSessionId: SessionId;
  senderAgentId: string;
  senderSessionId: SessionId;
  getBranchGeneration: () => number;
  isShuttingDown: () => boolean;
  budget: ReturnType<typeof createPeerMessageBudget>;
}): SubagentPort {
  const unavailable = async (): Promise<never> => {
    throw new Error("A child agent cannot spawn agents.");
  };
  return {
    launch: unavailable,
    run: unavailable,
    async sendMessage(request, sendOptions): Promise<SubagentSendMessageResult> {
      const messageId = `msg_${randomUUID()}`;
      const fail = (message: string): SubagentSendMessageResult => ({ status: "failed", messageId, message, error: message });
      if (sendOptions?.signal?.aborted || options.isShuttingDown()) return fail("Peer messaging is unavailable.");
      if (request.sessionId !== options.senderSessionId) return fail("Peer sender session does not match.");
      const generation = options.getBranchGeneration();
      const validTask = (task: RuntimeTaskSnapshot) =>
        task.type === "local_agent" && task.parentSessionId === options.parentSessionId &&
        task.branchGeneration === generation && !isTerminalRuntimeTask(task);
      const sender = options.registry.get(options.senderAgentId);
      if (!sender || !validTask(sender) || sender.childSessionId !== options.senderSessionId) return fail("Peer sender is not active in this session.");
      const key = `${sender.agentId}\0${String(request.parentToolCallId)}`;
      const digest = createHash("sha256").update(JSON.stringify([request.to, request.summary, request.message])).digest("hex");
      const prior = options.budget.lookup(key, digest);
      if (prior.kind === "existing") return prior.result;
      if (prior.kind === "conflict") return fail("Peer message tool call was already used with different content.");
      const target = resolveTarget(request, Object.values(options.registry.all()).filter(validTask));
      if (target.length !== 1) return fail(target.length ? "Peer name is ambiguous; use an agent ID." : "No active peer matches this recipient.");
      const recipient = target[0]!;
      if (recipient.agentId === sender.agentId) return fail("Cannot send a peer message to yourself.");
      const messageSink = recipient.messageSink;
      if (!messageSink) return fail("Peer is not ready to receive a message.");
      const result = options.budget.start(key, digest, async () => {
        try {
        // 接收方的 CommandInbox 是唯一准入点；失败时不写第二份待投递队列。
        const delivery = await messageSink.send({
          id: messageId, isMeta: true, message: request.message, summary: request.summary,
          queuedAt: new Date(), traceContext: request.trace,
          origin: { kind: "peer", agentId: sender.agentId, agentType: sender.agentType, toolCallId: String(request.parentToolCallId) },
        });
          return { status: "success", messageId, agentId: recipient.agentId, taskId: recipient.taskId, delivery, message: `Message accepted by ${recipient.agentId}.` };
        } catch {
          return fail("Peer message was not accepted.");
        }
      });
      return result ?? fail("Peer message limit reached for this session runtime.");
    },
  };
}

function resolveTarget(request: SubagentSendMessageRequest, tasks: RuntimeTaskSnapshot[]): RuntimeTaskSnapshot[] {
  const value = request.to.trim().replace(/^@/, "");
  const byId = tasks.filter((task) => task.agentId === value);
  return byId.length ? byId : tasks.filter((task) => task.agentType.toLowerCase() === value.toLowerCase());
}

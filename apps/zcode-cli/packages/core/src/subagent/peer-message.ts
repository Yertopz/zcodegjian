import { createHash, randomUUID } from "node:crypto";
import type { SessionId, SubagentMentionBudget, SubagentPort, SubagentSendMessageRequest, SubagentSendMessageResult } from "@zcode/contracts";
import { isTerminalRuntimeTask, type RuntimeTaskRegistry, type RuntimeTaskSnapshot } from "../runtime-task/registry.js";

/**
 * 非团队会话的同伴预算：一个父运行时内所有子智能体共用这 32 次。
 * 团队模式下由设置页的 `mentionLimit` 覆盖，见 `runtime/helpers/multi-agent-config.ts`。
 */
export const DEFAULT_PEER_MESSAGE_BUDGET = 32;

/** 一份额度属于父运行时，所有子智能体共用；失败的投递也消耗额度以限制重试循环。 */
export function createPeerMessageBudget(limit = DEFAULT_PEER_MESSAGE_BUDGET) {
  let attempts = 0;
  const calls = new Map<string, { digest: string; result: Promise<SubagentSendMessageResult> }>();
  return {
    limit,
    /** 剩余可发次数。用尽后 `start` 返回 undefined，`SendMessage` 仍注册但会明确报错。 */
    remaining() {
      return Math.max(0, limit - attempts);
    },
    lookup(key: string, digest: string) {
      const existing = calls.get(key);
      if (!existing) return { kind: "new" as const };
      if (existing.digest !== digest) return { kind: "conflict" as const };
      return { kind: "existing" as const, result: existing.result };
    },
    start(
      key: string,
      digest: string,
      run: (mentionBudget: SubagentMentionBudget) => Promise<SubagentSendMessageResult>,
    ) {
      if (attempts >= limit) return undefined;
      attempts += 1;
      // 快照在扣减之后取：消息文本里的「剩余」与真实可用次数一致，不受并发投递影响。
      const mentionBudget: SubagentMentionBudget = { remaining: Math.max(0, limit - attempts), limit };
      let finish!: (result: SubagentSendMessageResult) => void;
      const result = new Promise<SubagentSendMessageResult>((resolve) => { finish = resolve; });
      // 先登记 promise 再调用接收端，保证并发重试共享同一次准入。
      calls.set(key, { digest, result });
      void run(mentionBudget).then(finish);
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
      const snapshot = (): SubagentMentionBudget => ({
        remaining: options.budget.remaining(),
        limit: options.budget.limit,
      });
      const fail = (message: string): SubagentSendMessageResult => ({
        status: "failed",
        messageId,
        message,
        error: message,
        mentionBudget: snapshot(),
      });
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
      const result = options.budget.start(key, digest, async (mentionBudget) => {
        try {
        // 接收方的 CommandInbox 是唯一准入点；失败时不写第二份待投递队列。
        const delivery = await messageSink.send({
          id: messageId, isMeta: true, message: request.message, summary: request.summary,
          queuedAt: new Date(), traceContext: request.trace,
          // mentionBudget 随消息一起进注入提示：接收方看到的就是这次投递扣完后的剩余次数。
          origin: { kind: "peer", agentId: sender.agentId, agentType: sender.agentType, toolCallId: String(request.parentToolCallId), mentionBudget },
        });
          return { status: "success", messageId, agentId: recipient.agentId, taskId: recipient.taskId, delivery, message: `Message accepted by ${recipient.agentId}.`, mentionBudget };
        } catch {
          return fail("Peer message was not accepted.");
        }
      });
      // 用尽时不再静默降级：报错里带上上限，模型才能向用户解释而不是无限重试。
      return result ?? fail(`Peer message limit reached for this session runtime (limit ${options.budget.limit}).`);
    },
  };
}

function resolveTarget(request: SubagentSendMessageRequest, tasks: RuntimeTaskSnapshot[]): RuntimeTaskSnapshot[] {
  const value = request.to.trim().replace(/^@/, "");
  const byId = tasks.filter((task) => task.agentId === value);
  return byId.length ? byId : tasks.filter((task) => task.agentType.toLowerCase() === value.toLowerCase());
}

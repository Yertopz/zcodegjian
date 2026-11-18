import type { CommandAck } from "@zcode/shared/zcode-protocol-v4";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";

interface DelayPlan {
  commandMs: number;
  ackMs: number;
  consumed?: boolean;
  ackReleased?: boolean;
  rejectBeforeSend?: boolean;
}
/** 仅 E2E build 的传输故障注入；延迟或在发送前拒绝，不伪造 accepted/event。 */
export async function sendWithConversationDelayE2E(
  send: () => Promise<CommandAck>,
): Promise<CommandAck> {
  const host =
    typeof window === "undefined"
      ? undefined
      : (window as Window & { __zcodeTransportDelayE2E?: DelayPlan });
  const plan = shouldExposeE2EStoreBridge() ? host?.__zcodeTransportDelayE2E : undefined;
  if (!plan || plan.consumed) return send();
  plan.consumed = true;
  if (plan.rejectBeforeSend) throw new Error("IDE_E2E_TRANSPORT_REJECTED");
  const delay = (ms: number) =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, Number.isFinite(ms) ? Math.min(10000, Math.max(0, ms)) : 0),
    );
  await delay(plan.commandMs);
  const ack = await send();
  await delay(plan.ackMs);
  plan.ackReleased = true;
  return ack;
}

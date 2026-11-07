import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationTopicFrameSchema,
  type ConversationRow,
  type ConversationTopicFrame,
  type TopicFrameDeliveryKind,
} from "@zcode/shared/zcode-protocol-v4";
import { createInitialConversationSnapshot } from "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/projection-state.js";
import { SessionDataLayer } from "../src/v4/sessionDataLayer.js";
import { selectAgentReplyPreview } from "../src/v4/collaborationReplyPreview.js";

const topic = "conversation/child";
const subscriptionId = "subscription";
const row: ConversationRow = {
  kind: "assistantText",
  rowId: 1,
  turnId: "turn",
  createdAt: 201,
  createdAtSeq: 1,
  state: "streaming",
  text: "第一段",
};

function snapshot(text = "第一段", seq = 1) {
  const value = createInitialConversationSnapshot("child", "epoch");
  value.seq = seq;
  value.rows = { window: [{ ...row, text }], totalCount: 1, firstRowId: 1 };
  return value;
}

function frame(
  payload: ConversationTopicFrame["payload"],
  fromSeq: number,
  toSeq: number,
): ConversationTopicFrame {
  return conversationTopicFrameSchema.parse({
    topic,
    subscriptionId,
    fromSeq,
    toSeq,
    sentAt: 1,
    payload,
  });
}

function makeTransport() {
  const listeners = new Set<
    (event: ConversationTopicFrame, delivery: { deliveryKind: TopicFrameDeliveryKind }) => void
  >();
  let resyncs = 0;
  const emit = (event: ConversationTopicFrame, deliveryKind: TopicFrameDeliveryKind) => {
    for (const listener of listeners) listener(event, { deliveryKind });
  };
  const transport = {
    onFrame(
      listener: (
        event: ConversationTopicFrame,
        delivery: { deliveryKind: TopicFrameDeliveryKind },
      ) => void,
    ) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onAssemblyFault: () => () => {},
    onRuntimeRestart: () => () => {},
    subscribe: async () => ({
      ack: { subscriptionId, mode: "snapshot" as const, logEpoch: "epoch" },
    }),
    activate: () => emit(frame({ kind: "snapshot", snapshot: snapshot() }, 0, 1), "initial"),
    unsubscribe: async () => {},
    resync: async () => {
      resyncs += 1;
      queueMicrotask(() =>
        emit(frame({ kind: "snapshot", snapshot: snapshot("重连后的回复", 4) }, 1, 4), "recovery"),
      );
      return { ack: { subscriptionId, mode: "snapshot" as const } };
    },
  };
  return {
    transport,
    emit,
    get resyncs() {
      return resyncs;
    },
  };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("桌面连续流和手机重放恢复都在实际数据层消费子会话正文", async () => {
  for (const mode of ["desktop-continuous", "web-remote-replayable"] as const) {
    const fake = makeTransport();
    const layer = new SessionDataLayer({ transport: fake.transport as never, keepWarmMs: 0 });
    const lease = layer.acquire("child");
    try {
      await settle();
      assert.equal(lease.store.getState().status, "live");
      assert.equal(
        selectAgentReplyPreview(lease.store.getState().snapshot!.rows.window, 200)?.text,
        "第一段",
      );
      if (mode === "desktop-continuous") {
        fake.emit(
          frame(
            {
              kind: "deltas",
              deltas: [{ op: "row.delta", rowId: 1, path: "text", append: "续写" }],
            },
            1,
            2,
          ),
          "online",
        );
        assert.equal(
          selectAgentReplyPreview(lease.store.getState().snapshot!.rows.window, 200)?.text,
          "第一段续写",
        );
      } else {
        fake.emit(
          frame(
            {
              kind: "deltas",
              deltas: [{ op: "row.delta", rowId: 1, path: "text", append: "丢失的帧" }],
            },
            3,
            4,
          ),
          "online",
        );
        await settle();
        assert.equal(fake.resyncs, 1);
        assert.equal(
          selectAgentReplyPreview(lease.store.getState().snapshot!.rows.window, 200)?.text,
          "重连后的回复",
        );
      }
    } finally {
      lease.release();
      layer.dispose();
    }
  }
});

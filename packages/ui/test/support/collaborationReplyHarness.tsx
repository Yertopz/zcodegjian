import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationAgentReply } from "../../src/v4/ConversationAgentReply.js";

type Row = {
  kind: "assistantText";
  rowId: number;
  turnId: string;
  createdAt: number;
  createdAtSeq: number;
  text: string;
  state: "streaming" | "complete";
};
type Listener = () => void;
const states = new Map<
  string,
  { snapshot: { sessionId: string; rows: { window: Row[] } } | null; status: string }
>();
const listeners = new Map<string, Set<Listener>>();
const released: string[] = [];
const layer = {
  acquire(sessionId: string) {
    if (!states.has(sessionId)) states.set(sessionId, { snapshot: null, status: "connecting" });
    if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
    return {
      sessionId,
      store: {
        getState: () => states.get(sessionId),
        subscribe: (listener: Listener) => {
          listeners.get(sessionId)!.add(listener);
          return () => listeners.get(sessionId)!.delete(listener);
        },
      },
      release: () => released.push(sessionId),
    };
  },
};
Object.assign(window, {
  collaborationReplyHarness: {
    layer,
    released,
    update(sessionId: string, rows: Row[]) {
      states.set(sessionId, { snapshot: { sessionId, rows: { window: rows } }, status: "live" });
      listeners.get(sessionId)?.forEach((listener) => listener());
    },
  },
});

function Harness() {
  const [sessionId, setSessionId] = useState("child-a");
  const [startedAt, setStartedAt] = useState(200);
  const [visible, setVisible] = useState(true);
  const [opened, setOpened] = useState(0);
  return (
    <>
      <button onClick={() => setSessionId("child-b")}>切换子会话</button>
      <button onClick={() => setStartedAt(400)}>新一轮</button>
      <button onClick={() => setVisible(false)}>卸载</button>
      {visible ? (
        <ConversationAgentReply
          childSessionId={sessionId}
          startedAt={startedAt}
          agentName="reviewer"
          context={{ workspacePath: "fixture", theme: "light", codePreviewSettings: {} as never }}
          onOpen={() => setOpened((count) => count + 1)}
        />
      ) : null}
      <output data-testid="opened">{opened}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);

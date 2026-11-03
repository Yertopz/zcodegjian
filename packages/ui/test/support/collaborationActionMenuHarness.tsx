import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LexicalChatInputHandle } from "../../src/LexicalChatInput.js";
import { ChatPromptActionMenu } from "../../src/prompt-editor/ChatPromptActionMenu.js";

function Harness() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const inputApiRef = useRef<LexicalChatInputHandle | null>({
    getText: () => "",
    getEditorState: () => undefined,
    insertMention: (item) => setDraft(item.markdown),
    focus: () => {},
  } as unknown as LexicalChatInputHandle);
  return (
    <>
      <div ref={setContainer} style={{ width: 500, height: 50 }} />
      <ChatPromptActionMenu
        actionMenuTitle="添加"
        workspacePath="fixture"
        sessionId={null}
        container={container}
        showPlugins
        attachmentAction={{ label: "附件", onSelect: () => {} }}
        inputApiRef={inputApiRef}
      />
      <output data-testid="draft">{draft}</output>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

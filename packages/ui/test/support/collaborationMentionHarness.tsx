import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { $getRoot } from "lexical";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { MentionPlugin } from "../../src/mentions/MentionPlugin.js";
import {
  PromptMentionNode,
  $isPromptMentionNode,
} from "../../src/mentions/nodes/PromptMentionNode.js";

function Harness() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [markdown, setMarkdown] = useState("");
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "mention-test",
        nodes: [PromptMentionNode],
        onError: (error) => {
          throw error;
        },
      }}
    >
      <div ref={setContainer} data-testid="panel" />
      <PlainTextPlugin
        contentEditable={<ContentEditable data-testid="input" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <MentionPlugin
        workspacePath="fixture"
        provider={ZCODE_AGENT_PROVIDER}
        container={container}
      />
      <OnChangePlugin
        onChange={(state) =>
          state.read(() => {
            const text = $getRoot()
              .getChildren()
              .flatMap((paragraph) =>
                "getChildren" in paragraph && typeof paragraph.getChildren === "function"
                  ? paragraph
                      .getChildren()
                      .map((node) =>
                        $isPromptMentionNode(node) ? node.getMarkdown() : node.getTextContent(),
                      )
                  : [],
              )
              .join("");
            setMarkdown(text);
          })
        }
      />
      <output data-testid="markdown">{markdown}</output>
    </LexicalComposer>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

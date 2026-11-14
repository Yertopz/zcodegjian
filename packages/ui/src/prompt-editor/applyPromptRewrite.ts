import {
  $copyNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { $getPromptMarkdown } from "@/mentions/promptSerialization.js";
import { $isPromptMentionNode } from "@/mentions/nodes/PromptMentionNode.js";
import { $isInlineAttachmentNode } from "./InlineAttachmentNode.js";
import { PROGRAMMATIC_UPDATE_TAG } from "@/lib/editorUpdateTags.js";

/** 原文未改变且引用完整时才替换；复制原节点，保留附件/mention 身份并形成独立撤销步骤。 */
export function applyPromptRewrite(
  editor: LexicalEditor,
  output: string,
  expected: string,
): boolean {
  let applied = false;
  editor.update(
    () => {
      if ($getPromptMarkdown() !== expected) return;
      const tokens = new Map<string, LexicalNode[]>();
      const collect = (node: LexicalNode) => {
        if ($isInlineAttachmentNode(node) || $isPromptMentionNode(node)) {
          const text = $getPromptMarkdown(node);
          const nodes = tokens.get(text) ?? [];
          nodes.push(node);
          tokens.set(text, nodes);
        } else if ($isElementNode(node)) node.getChildren().forEach(collect);
      };
      collect($getRoot());
      for (const [token, nodes] of tokens)
        if (output.split(token).length - 1 !== nodes.length) return;
      const alternatives = [...tokens.keys()].sort((a, b) => b.length - a.length);
      const paragraphs = output.split("\n\n").map((line) => {
        const paragraph = $createParagraphNode();
        let offset = 0;
        while (offset < line.length) {
          const next = alternatives
            .map((token) => ({ token, index: line.indexOf(token, offset) }))
            .filter((item) => item.index >= 0)
            .sort((a, b) => a.index - b.index)[0];
          if (!next) {
            paragraph.append($createTextNode(line.slice(offset)));
            break;
          }
          if (next.index > offset)
            paragraph.append($createTextNode(line.slice(offset, next.index)));
          const node = tokens.get(next.token)!.shift()!;
          paragraph.append($copyNode(node));
          offset = next.index + next.token.length;
        }
        return paragraph;
      });
      $getRoot()
        .clear()
        .append(...paragraphs);
      $getRoot().selectEnd();
      applied = true;
    },
    { tag: [PROGRAMMATIC_UPDATE_TAG, HISTORY_PUSH_TAG], discrete: true },
  );
  return applied;
}

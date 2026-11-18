import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $applyNodeReplacement,
  $createTextNode,
  $getRoot,
  $getSelection,
  $getNearestNodeFromDOMNode,
  $isRangeSelection,
  $nodesOfType,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import { FileIcon, XIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { PROGRAMMATIC_UPDATE_TAG } from "@/lib/editorUpdateTags.js";
import { $isPromptMentionNode } from "@/mentions/nodes/PromptMentionNode.js";

export interface InlineAttachmentItem {
  id: string;
  filename: string;
  mimeType: string;
  objectUrl?: string;
  uploadStatus: string;
  uploadProgress: number;
  uploadError?: string;
}
export interface InlineAttachmentContextValue {
  scopeKey: string;
  ready: boolean;
  items: readonly InlineAttachmentItem[];
  remove: (id: string) => void;
  open: (id: string) => void;
  retry: (id: string) => void;
  openFile?: (path: string, title: string) => void;
}
export const InlineAttachmentContext = createContext<InlineAttachmentContextValue | null>(null);
type SerializedInlineAttachment = SerializedLexicalNode & { id: string; label: string };

/** 节点只保存身份和标签；二进制、上传事实和 URL 始终归附件 store。 */
export class InlineAttachmentNode extends DecoratorNode<ReactNode> {
  __id: string;
  __label: string;
  static getType() {
    return "composer-attachment";
  }
  static clone(node: InlineAttachmentNode) {
    return new InlineAttachmentNode(node.__id, node.__label, node.__key);
  }
  static importJSON(node: SerializedInlineAttachment) {
    return $createInlineAttachmentNode(node.id, node.label);
  }
  constructor(id: string, label: string, key?: NodeKey) {
    super(key);
    this.__id = id;
    this.__label = label;
  }
  createDOM() {
    const span = document.createElement("span");
    span.className = "inline-block align-middle";
    return span;
  }
  updateDOM() {
    return false;
  }
  isInline() {
    return true;
  }
  getTextContent() {
    return `[${this.__label}](attachment:${this.__id})`;
  }
  exportJSON(): SerializedInlineAttachment {
    return {
      ...super.exportJSON(),
      type: "composer-attachment",
      version: 1,
      id: this.__id,
      label: this.__label,
    };
  }
  decorate() {
    return <InlineAttachment id={this.__id} label={this.__label} />;
  }
}
export function $createInlineAttachmentNode(id: string, label: string) {
  return $applyNodeReplacement(new InlineAttachmentNode(id, label));
}
export function $isInlineAttachmentNode(node: LexicalNode): node is InlineAttachmentNode {
  return node instanceof InlineAttachmentNode;
}

function InlineAttachment({ id, label }: { id: string; label: string }) {
  const context = useContext(InlineAttachmentContext);
  const { intl } = useZCodeIntl();
  const item = context?.items.find((candidate) => candidate.id === id);
  return (
    <span
      contentEditable={false}
      data-inline-attachment={id}
      className="mx-1 inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1 align-middle text-ui-caption"
    >
      <button
        type="button"
        onDoubleClick={() => context?.open(id)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            context?.open(id);
          }
        }}
        title={item?.filename ?? label}
        className="inline-flex min-w-0 items-center gap-2 text-left"
      >
        {item?.mimeType.startsWith("image/") && item.objectUrl ? (
          <img
            src={item.objectUrl}
            alt=""
            className="size-10 rounded object-cover"
            draggable={false}
          />
        ) : (
          <FileIcon className="size-6 shrink-0" />
        )}
        <span className="min-w-0">
          <span className="block max-w-48 truncate">{label}</span>
          {item?.uploadStatus !== "ready" ? (
            <span role="status" title={item?.uploadError} className="text-foreground-subtle">
              {item?.uploadStatus === "failed"
                ? intl.formatMessage({ id: "chat.composer.inline.failed" })
                : `${item?.uploadProgress ?? 0}%`}
            </span>
          ) : null}
        </span>
      </button>
      {item?.uploadStatus === "failed" ? (
        <button type="button" onClick={() => context?.retry(id)}>
          {intl.formatMessage({ id: "chat.attachments.upload.retry" })}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "chat.attachments.remove" })}
        onClick={() => context?.remove(id)}
        className="shrink-0"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

export function InlineAttachmentsPlugin() {
  const [editor] = useLexicalComposerContext();
  const context = useContext(InlineAttachmentContext);
  const { intl } = useZCodeIntl();
  const known = useRef<{ scope: string; ids: Set<string>; imageNumber: number }>({
    scope: "",
    ids: new Set(),
    imageNumber: 0,
  });
  const latest = useRef(context);
  latest.current = context;
  useEffect(() => {
    const openFile = (event: MouseEvent) => {
      // DOM -> 节点定位还需要 active editor，editorState.read 只提供 state，会触发 Lexical #196。
      editor.read(() => {
        if (!(event.target instanceof Node)) return;
        const node = $getNearestNodeFromDOMNode(event.target);
        if (!node || !$isPromptMentionNode(node)) return;
        const mention = node.getMention();
        if (mention.category === "files" && mention.data?.kind !== "directory")
          latest.current?.openFile?.(mention.data?.path ?? mention.value, mention.label);
      });
    };
    return editor.registerRootListener((root, previous) => {
      previous?.removeEventListener("dblclick", openFile);
      root?.addEventListener("dblclick", openFile);
    });
  }, [editor]);
  useEffect(() => {
    if (!context?.ready) return;
    if (known.current.scope !== context.scopeKey)
      known.current = { scope: context.scopeKey, ids: new Set(), imageNumber: 0 };
    editor.update(
      () => {
        // 队列撤回和旧草稿可能只有 canonical 正文；按本 scope 的真实附件恢复原位置。
        for (const textNode of $getRoot().getAllTextNodes()) {
          if (textNode.getType() !== "text") continue;
          const text = textNode.getTextContent();
          const matches = [
            ...text.matchAll(/\[([^\]\n]+)\]\(attachment(-index)?:([^\s)]+)\)/g),
          ].filter((match) =>
            match[2]
              ? context.items[Number(match[3])]
              : context.items.some((item) => item.id === match[3]),
          );
          if (!matches.length) continue;
          let offset = 0;
          for (const match of matches) {
            if (match.index > offset)
              textNode.insertBefore($createTextNode(text.slice(offset, match.index)));
            const item = match[2]
              ? context.items[Number(match[3])]!
              : context.items.find((candidate) => candidate.id === match[3])!;
            textNode.insertBefore($createInlineAttachmentNode(item.id, match[1]!));
            offset = match.index + match[0].length;
          }
          if (offset < text.length) textNode.insertBefore($createTextNode(text.slice(offset)));
          textNode.remove();
        }
        const nodes = $nodesOfType(InlineAttachmentNode);
        const present = new Set(nodes.map((node) => node.__id));
        const valid = new Set(context.items.map((item) => item.id));
        for (const node of nodes) if (!valid.has(node.__id)) node.remove();
        for (const node of nodes) {
          known.current.ids.add(node.__id);
          if (context.items.find((item) => item.id === node.__id)?.mimeType.startsWith("image/"))
            known.current.imageNumber = Math.max(
              known.current.imageNumber,
              Number(/(\d+)\s*$/.exec(node.__label)?.[1] ?? 0),
            );
        }
        const additions = context.items.filter(
          (item) => !known.current.ids.has(item.id) && !present.has(item.id),
        );
        for (const item of additions) {
          const index = item.mimeType.startsWith("image/") ? ++known.current.imageNumber : 0;
          const label = item.mimeType.startsWith("image/")
            ? intl.formatMessage({ id: "chat.composer.inline.image" }, { index })
            : item.filename.replace(/[\]\n]/g, "_");
          const node = $createInlineAttachmentNode(item.id, label);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            // 添加文件不能替换掉原有文字选区，在选区焦点处插入。
            if (!selection.isCollapsed())
              selection.anchor.set(
                selection.focus.key,
                selection.focus.offset,
                selection.focus.type,
              );
            selection.insertNodes([node]);
          } else {
            $getRoot().selectEnd();
            const tail = $getSelection();
            if ($isRangeSelection(tail)) tail.insertNodes([node]);
          }
          known.current.ids.add(item.id);
        }
      },
      { tag: PROGRAMMATIC_UPDATE_TAG },
    );
  }, [context, editor, intl]);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, prevEditorState, tags }) => {
        const current = latest.current;
        if (!current?.ready || tags.has(PROGRAMMATIC_UPDATE_TAG)) return;
        const before = prevEditorState.read(() =>
          $nodesOfType(InlineAttachmentNode).map((node) => node.__id),
        );
        const after = new Set(
          editorState.read(() => $nodesOfType(InlineAttachmentNode).map((node) => node.__id)),
        );
        // 删除正文中的引用也移除对应附件，避免发送看不见的文件；程序回填不触发删除。
        for (const id of before) if (!after.has(id)) current.remove(id);
      }),
    [editor],
  );
  return null;
}

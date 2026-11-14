import type { EditorState } from "@codemirror/state";
import type { IdeEditorTab } from "../store/ideEditorTypes.js";

export const IDE_EDITOR_CACHE_DOCUMENT_LIMIT = 1_048_576;
const IDE_EDITOR_CACHE_ENTRY_LIMIT = 4;
type CurrentTab = Pick<IdeEditorTab, "path" | "instanceId" | "docVersion" | "draftContent">;

export interface IdeEditorStateSnapshot {
  path: string;
  instanceId: number;
  docVersion: number;
  /** 仅用于与 store 草稿核对；缓存不成为第二个草稿写入入口。 */
  content: string;
  state: EditorState;
}

function matches(entry: IdeEditorStateSnapshot, tab: CurrentTab): boolean {
  return (
    entry.path === tab.path &&
    entry.instanceId === tab.instanceId &&
    entry.docVersion === tab.docVersion &&
    entry.content === tab.draftContent
  );
}

/** 只缓存非活动文档的界面状态，不保留隐藏 EditorView / DOM。 */
export function createIdeEditorStateCache<
  T extends IdeEditorStateSnapshot = IdeEditorStateSnapshot,
>() {
  const entries = new Map<number, T>();
  let documentLength = 0;
  function remove(instanceId: number) {
    const entry = entries.get(instanceId);
    if (entry) documentLength -= entry.content.length;
    entries.delete(instanceId);
    return entry;
  }
  return {
    put(entry: T) {
      remove(entry.instanceId);
      if (entry.content.length > IDE_EDITOR_CACHE_DOCUMENT_LIMIT) return;
      entries.set(entry.instanceId, entry);
      documentLength += entry.content.length;
      // 切走时进入队尾；重新激活会取出，因此超预算时淘汰最久未使用状态。
      while (
        entries.size > IDE_EDITOR_CACHE_ENTRY_LIMIT ||
        documentLength > IDE_EDITOR_CACHE_DOCUMENT_LIMIT
      ) {
        remove(entries.keys().next().value!);
      }
    },
    take(tab: CurrentTab): T | undefined {
      const entry = remove(tab.instanceId);
      return entry && matches(entry, tab) ? entry : undefined;
    },
    prune(tabs: readonly CurrentTab[]) {
      const current = new Map(tabs.map((tab) => [tab.instanceId, tab]));
      for (const [id, entry] of entries) {
        const tab = current.get(id);
        if (!tab || !matches(entry, tab)) remove(id);
      }
    },
    clear() {
      entries.clear();
      documentLength = 0;
    },
  };
}

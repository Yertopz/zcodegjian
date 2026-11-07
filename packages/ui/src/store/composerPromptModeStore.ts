import { create } from "zustand";
import { isMultiAgentModeActive } from "@/lib/multiAgentMode.js";

/**
 * 「当前输入框选中的主提示词」的跨组件快照（提示词模式判定的唯一来源之一）。
 *
 * 为什么需要这个 store：主提示词选择器挂在 V4 composer 里，而 `@` 提及面板、
 * 群聊气泡皮、设置入口分散在别的组件树节点上，都只拿得到草稿不需要的 props。
 * 直接把选择往下透传会把 `V4ComposerDraft.mainAgentPromptId` 的所有者搅乱
 * （草稿仍是唯一事实源，这里只是只读投影），所以用一个按 scope 分键的轻量 store 桥接。
 *
 * 三条不变量：
 * ① 每个键的写入者只有一个 —— `MainAgentPromptSelector` 的投影 effect；别处只读。
 * ② 「新建任务」时写 `pending`：表示「当前提示词还没定」，此时判定回落到团队开关，
 *    避免沿用上一个会话选的提示词把新任务误判成多智能体模式。
 * ③ 只有 `resolved` 才代表「已知当前提示词」；`pending` 与缺键语义相同，
 *    这样选择器还没挂载/还没算出来时不会闪成错误模式。
 */
export interface ComposerPromptModeEntry {
  status: "pending" | "resolved";
  mainAgentPromptId: string | null;
}

interface ComposerPromptModeState {
  scopes: Record<string, ComposerPromptModeEntry>;
  setEntry: (scopeKey: string, entry: ComposerPromptModeEntry) => void;
}

/**
 * scope 键 = 工作区身份 + 会话 id（草稿/新建任务时会话段为空）。
 * 工作区身份沿用仓库统一口径 `workspaceIdentity?.trim() || workspacePath`：
 * 远程工作区的 path 可能相同而 identity 不同，只用 path 会串开两个工作区。
 */
export function resolveComposerPromptScopeKey(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId?: string | null,
): string {
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  return `${workspaceKey}::${sessionId?.trim() ?? ""}`;
}

export const useComposerPromptModeStore = create<ComposerPromptModeState>((set) => ({
  scopes: {},
  setEntry: (scopeKey, entry) =>
    set((state) => {
      const previous = state.scopes[scopeKey];
      // 同值不写：调用方是 effect，每轮都写会把自己重新唤醒成死循环。
      if (
        previous &&
        previous.status === entry.status &&
        previous.mainAgentPromptId === entry.mainAgentPromptId
      ) {
        return state;
      }
      return { scopes: { ...state.scopes, [scopeKey]: entry } };
    }),
}));

/** 读某个 scope 的提示词快照；缺键返回 undefined（与 pending 等价）。 */
export function useComposerPromptMode(scopeKey: string): ComposerPromptModeEntry | undefined {
  return useComposerPromptModeStore((state) => state.scopes[scopeKey]);
}

/** 选择器投影：占位写入（尚未算出当前提示词）。 */
export function markComposerPromptScopePending(scopeKey: string): void {
  useComposerPromptModeStore
    .getState()
    .setEntry(scopeKey, { status: "pending", mainAgentPromptId: null });
}

/** 选择器投影：已算出当前提示词（null = 默认提示词）。 */
export function syncComposerPromptScope(scopeKey: string, mainAgentPromptId: string | null): void {
  useComposerPromptModeStore
    .getState()
    .setEntry(scopeKey, { status: "resolved", mainAgentPromptId });
}

/**
 * 「新建任务」时重置：把该 scope 打回 pending。
 * 不删键而是写 pending —— 删除会让「选择器已挂载但还没投影」和「从没挂载过」不可区分，
 * 而项目里两者都需要回落到团队开关，pending 是同一语义的更明确表达。
 */
export function resetComposerPromptScope(scopeKey: string): void {
  markComposerPromptScopePending(scopeKey);
}

/**
 * 把提示词快照与团队开关合成为「是否多智能体模式」。
 * 判定规则本身集中在 `isMultiAgentModeActive`，这里只负责 pending/缺键的回落。
 */
export function resolveComposerMultiAgentMode(
  entry: ComposerPromptModeEntry | undefined,
  multiAgentEnabled: boolean | undefined,
): boolean {
  if (entry?.status === "resolved") {
    return isMultiAgentModeActive({
      mainAgentPromptId: entry.mainAgentPromptId,
      multiAgentEnabled,
    });
  }
  return multiAgentEnabled === true;
}

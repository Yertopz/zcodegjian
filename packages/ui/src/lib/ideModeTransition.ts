import type { InterfaceMode } from "./interfaceMode.js";
import { hasIdeDirty, hasIdeSaving, type useIdeEditorStore } from "../store/ideEditorStore.js";

export function createIdeModeTransition(deps: {
  editor: typeof useIdeEditorStore;
  getMode: () => InterfaceMode;
  commit: (mode: InterfaceMode, fromBroadcast: boolean) => void;
  confirmDiscard: () => Promise<boolean>;
  notifySaving: () => void;
}) {
  let pending = false;
  return {
    async request(mode: InterfaceMode, fromBroadcast = false): Promise<boolean> {
      if (pending) return false;
      if (mode === deps.getMode()) return true;
      const leaving = deps.getMode() === "ide" && mode !== "ide";
      if (leaving && hasIdeSaving(deps.editor.getState())) {
        deps.notifySaving();
        return false;
      }
      pending = true;
      try {
        if (leaving) {
          // 全窗口统一冻结；确认期间其他工作区也不能产生未经确认的新编辑/保存。
          deps.editor.getState().setExitPending(true);
          if (hasIdeDirty(deps.editor.getState()) && !(await deps.confirmDiscard())) return false;
          deps.editor.getState().clearAll();
        }
        deps.commit(mode, fromBroadcast);
        return true;
      } finally {
        if (leaving) deps.editor.getState().setExitPending(false);
        pending = false;
      }
    },
  };
}

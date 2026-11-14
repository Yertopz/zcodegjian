import type { IFileService } from "@zcode/services";
import { isIdeTabDirty, useIdeEditorStore } from "../store/ideEditorStore.js";

type FileApi = Pick<IFileService, "readTextFileForEdit" | "readTextFile" | "writeTextFile">;
export function createIdeEditorController(key: string, file: FileApi, readOnly = false) {
  const store = useIdeEditorStore;
  let disposed = false;
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  async function load(path: string, requestId: number) {
    try {
      let snapshot: { content: string; version: string };
      let legacy = false;
      try {
        if (typeof file.readTextFileForEdit !== "function")
          throw Error("Method not found: readTextFileForEdit");
        snapshot = await file.readTextFileForEdit({ path });
        if (!snapshot.version) throw Error("file_edit_invalid_snapshot");
      } catch (error) {
        // 仅精确识别旧 Host 的缺方法错误；权限/断连等错误不可伪装成兼容降级。
        if (!message(error).includes("Method not found: readTextFileForEdit")) throw error;
        const slice = await file.readTextFile({ path, offset: 0, length: 256 * 1024 });
        if (slice.isBinary) throw Error("file_edit_binary");
        if (slice.truncated) throw Error("file_edit_too_large");
        snapshot = { content: slice.content, version: "" };
        legacy = true;
      }
      store.getState().loadSucceeded(key, path, requestId, snapshot, legacy || readOnly);
    } catch (error) {
      store.getState().loadFailed(key, path, requestId, message(error));
    }
  }
  return {
    async open(path: string) {
      const result = store.getState().openTab(key, path);
      if (result.kind === "opened") await load(path, result.requestId);
      return result.kind;
    },
    async reload(path: string) {
      const requestId = store.getState().beginReload(key, path);
      if (requestId !== null) await load(path, requestId);
    },
    async refreshChangedFile(path: string) {
      const tab = store.getState().byWorkspaceKey[key]?.tabs.find((item) => item.path === path);
      if (!tab || tab.save || tab.loadState === "loading") return;
      // Agent 修改只能刷新干净标签；脏内容的取舍仍由用户决定。
      if (isIdeTabDirty(tab)) {
        let version: string | undefined;
        try {
          version = (await file.readTextFileForEdit({ path })).version;
        } catch {
          // 明确修改事实对应的目标也可能已删除；草稿始终保留，提示用户核对。
        }
        const current = store
          .getState()
          .byWorkspaceKey[key]?.tabs.find((item) => item.path === path);
        if (
          !disposed &&
          current?.instanceId === tab.instanceId &&
          current.docVersion === tab.docVersion &&
          current.baseVersion === tab.baseVersion &&
          !current.save &&
          isIdeTabDirty(current) &&
          version !== current.baseVersion
        )
          store.getState().markDiskChanged(key, path);
      } else {
        const requestId = store.getState().beginReload(key, path);
        if (requestId !== null) await load(path, requestId);
      }
    },
    async save(path: string) {
      if (readOnly) return;
      const request = store.getState().beginSave(key, path);
      if (!request) return;
      try {
        const result = await file.writeTextFile({
          path,
          content: request.content,
          expectedVersion: request.expectedVersion,
        });
        if (!result.version) throw Error("file_edit_invalid_snapshot");
        store.getState().saveSucceeded(key, path, request.requestId, result.version);
      } catch (error) {
        store.getState().saveFailed(key, path, request.requestId, message(error));
      }
    },
    dispose() {
      disposed = true;
      store.getState().cancelLoads(key);
    },
  };
}

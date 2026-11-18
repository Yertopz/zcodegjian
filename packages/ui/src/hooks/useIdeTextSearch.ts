import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useWorkspaceServices } from "./useWorkspaceServices.js";
import { createIdeTextSearchController } from "@/ide-mode/ideTextSearchController.js";

export function useIdeTextSearch(
  rootPath: string,
  workspaceIdentity?: string,
  remoteSessionId?: string,
) {
  const { fileService } = useWorkspaceServices(rootPath, remoteSessionId, workspaceIdentity);
  const controller = useMemo(
    () => createIdeTextSearchController(fileService, { rootPath, workspaceIdentity }),
    [fileService, rootPath, workspaceIdentity, remoteSessionId],
  );
  useEffect(() => () => controller.dispose(), [controller]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { state, controller };
}
